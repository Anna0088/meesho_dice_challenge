import amqp from 'amqplib';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface EventMessage {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  correlationId: string;
  data: any;
  metadata?: {
    userId?: string;
    sellerId?: string;
    productId?: string;
    traceId?: string;
  };
}

export class EventBus extends EventEmitter {
  private connection: amqp.Connection | null = null;
  private channels: Map<string, amqp.Channel> = new Map();
  private readonly exchangeName = 'meesho-events';
  private readonly dlxName = 'meesho-events-dlx';
  private retryAttempts = 0;
  private readonly maxRetries = 5;

  constructor(private readonly serviceName: string) {
    super();
  }

  async connect(): Promise<void> {
    try {
      const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
      this.connection = await amqp.connect(rabbitmqUrl);

      this.connection.on('error', (err) => {
        logger.error('RabbitMQ connection error:', err);
        this.reconnect();
      });

      this.connection.on('close', () => {
        logger.warn('RabbitMQ connection closed');
        this.reconnect();
      });

      // Setup exchanges
      await this.setupExchanges();

      logger.info('EventBus connected successfully');
      this.retryAttempts = 0;
    } catch (error) {
      logger.error('Failed to connect to EventBus:', error);
      this.reconnect();
    }
  }

  private async reconnect(): Promise<void> {
    if (this.retryAttempts >= this.maxRetries) {
      logger.error('Max reconnection attempts reached');
      process.exit(1);
    }

    this.retryAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.retryAttempts), 30000);

    logger.info(`Reconnecting to EventBus in ${delay}ms (attempt ${this.retryAttempts})`);
    setTimeout(() => this.connect(), delay);
  }

  private async setupExchanges(): Promise<void> {
    const channel = await this.createChannel('setup');

    // Main exchange
    await channel.assertExchange(this.exchangeName, 'topic', {
      durable: true,
    });

    // Dead letter exchange
    await channel.assertExchange(this.dlxName, 'topic', {
      durable: true,
    });

    // Dead letter queue
    await channel.assertQueue('meesho-events-dlq', {
      durable: true,
      arguments: {
        'x-message-ttl': 86400000, // 24 hours
      },
    });

    await channel.bindQueue('meesho-events-dlq', this.dlxName, '#');
  }

  async publish(eventType: string, data: any, options: any = {}): Promise<void> {
    try {
      const channel = await this.getOrCreateChannel('publish');

      const event: EventMessage = {
        id: uuidv4(),
        type: eventType,
        source: this.serviceName,
        timestamp: new Date().toISOString(),
        correlationId: options.correlationId || uuidv4(),
        data,
        metadata: options.metadata || {},
      };

      // Add trace ID for distributed tracing
      if (!event.metadata.traceId) {
        event.metadata.traceId = uuidv4();
      }

      const message = Buffer.from(JSON.stringify(event));

      channel.publish(
        this.exchangeName,
        eventType,
        message,
        {
          persistent: true,
          timestamp: Date.now(),
          correlationId: event.correlationId,
          headers: {
            'x-source': this.serviceName,
            'x-event-type': eventType,
            'x-trace-id': event.metadata.traceId,
          },
        }
      );

      // Emit local event for monitoring
      this.emit('event:published', event);

      logger.debug(`Event published: ${eventType}`, {
        correlationId: event.correlationId,
        traceId: event.metadata.traceId,
      });
    } catch (error) {
      logger.error(`Failed to publish event ${eventType}:`, error);
      throw error;
    }
  }

  async subscribe(patterns: string[], handler: (event: EventMessage) => Promise<void>): Promise<void> {
    try {
      const channel = await this.getOrCreateChannel('consume');
      const queueName = `${this.serviceName}-queue`;

      // Create queue with dead letter exchange
      const queue = await channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': this.dlxName,
          'x-message-ttl': 3600000, // 1 hour
        },
      });

      // Bind patterns
      for (const pattern of patterns) {
        await channel.bindQueue(queue.queue, this.exchangeName, pattern);
      }

      // Set prefetch
      await channel.prefetch(10);

      // Consume messages
      await channel.consume(queue.queue, async (msg) => {
        if (!msg) return;

        const startTime = Date.now();

        try {
          const event: EventMessage = JSON.parse(msg.content.toString());

          // Update trace context
          if (event.metadata?.traceId) {
            process.env.TRACE_ID = event.metadata.traceId;
          }

          // Process event
          await handler(event);

          // Acknowledge
          channel.ack(msg);

          // Emit metrics
          this.emit('event:processed', {
            event,
            duration: Date.now() - startTime,
          });

          logger.debug(`Event processed: ${event.type}`, {
            correlationId: event.correlationId,
            duration: Date.now() - startTime,
          });
        } catch (error) {
          logger.error('Failed to process event:', error);

          // Requeue with exponential backoff
          const retryCount = (msg.properties.headers['x-retry-count'] || 0) + 1;

          if (retryCount <= 3) {
            setTimeout(() => {
              channel.nack(msg, false, true);
            }, Math.pow(2, retryCount) * 1000);
          } else {
            // Send to dead letter queue
            channel.nack(msg, false, false);
          }
        }
      });

      logger.info(`Subscribed to patterns: ${patterns.join(', ')}`);
    } catch (error) {
      logger.error('Failed to subscribe:', error);
      throw error;
    }
  }

  private async getOrCreateChannel(name: string): Promise<amqp.Channel> {
    if (!this.connection) {
      throw new Error('EventBus not connected');
    }

    if (!this.channels.has(name)) {
      const channel = await this.connection.createChannel();
      this.channels.set(name, channel);
    }

    return this.channels.get(name)!;
  }

  async disconnect(): Promise<void> {
    try {
      for (const [name, channel] of this.channels) {
        await channel.close();
      }
      this.channels.clear();

      if (this.connection) {
        await this.connection.close();
      }

      logger.info('EventBus disconnected');
    } catch (error) {
      logger.error('Error disconnecting EventBus:', error);
    }
  }

  // Circuit breaker pattern
  async publishWithCircuitBreaker(
    eventType: string,
    data: any,
    options: any = {}
  ): Promise<void> {
    const circuitBreaker = this.getCircuitBreaker(eventType);

    return circuitBreaker.execute(() => this.publish(eventType, data, options));
  }

  private getCircuitBreaker(eventType: string): any {
    // Implement circuit breaker logic
    return {
      execute: async (fn: Function) => {
        try {
          return await fn();
        } catch (error) {
          logger.error(`Circuit breaker opened for ${eventType}`);
          throw error;
        }
      },
    };
  }
}

// Singleton instances for each service
const eventBusInstances = new Map<string, EventBus>();

export function getEventBus(serviceName: string): EventBus {
  if (!eventBusInstances.has(serviceName)) {
    eventBusInstances.set(serviceName, new EventBus(serviceName));
  }
  return eventBusInstances.get(serviceName)!;
}