import amqp from 'amqplib';
import { logger } from './logger';

let connection: amqp.Connection | null = null;
let channel: amqp.Channel | null = null;
const exchangeName = process.env.RABBITMQ_EXCHANGE || 'meesho-events';

export async function connectPublisher(): Promise<void> {
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();

    await channel.assertExchange(exchangeName, 'topic', { durable: true });

    logger.info('Event publisher connected');
  } catch (error) {
    logger.error('Failed to connect event publisher:', error);
    throw error;
  }
}

export async function publishEvent(
  eventType: string,
  data: any,
  options: { correlationId?: string; priority?: number } = {}
): Promise<void> {
  try {
    if (!channel) {
      await connectPublisher();
    }

    const message = {
      eventType,
      data,
      timestamp: new Date().toISOString(),
      correlationId: options.correlationId || generateCorrelationId(),
    };

    const messageBuffer = Buffer.from(JSON.stringify(message));

    channel!.publish(
      exchangeName,
      eventType,
      messageBuffer,
      {
        persistent: true,
        priority: options.priority || 0,
        timestamp: Date.now(),
      }
    );

    logger.debug(`Event published: ${eventType}`, { data });
  } catch (error) {
    logger.error(`Failed to publish event ${eventType}:`, error);
    throw error;
  }
}

function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function disconnectPublisher(): Promise<void> {
  try {
    if (channel) {
      await channel.close();
    }
    if (connection) {
      await connection.close();
    }
    logger.info('Event publisher disconnected');
  } catch (error) {
    logger.error('Error disconnecting event publisher:', error);
  }
}