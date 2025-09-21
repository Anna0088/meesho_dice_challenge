import amqp from 'amqplib';
import { logger } from '../utils/logger';
import { sqsCalculationService } from '../services/sqsCalculationService';
import { getRedisClient } from '../config/redis';

const redis = getRedisClient;

interface EventMessage {
  eventType: string;
  sellerId: string;
  data: any;
  timestamp: string;
}

export class EventConsumer {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private readonly exchangeName = 'meesho-events';
  private readonly queueName = 'seller-service-queue';

  // Event types this service listens to
  private readonly subscribedEvents = [
    'order.created',
    'order.shipped',
    'order.delivered',
    'order.cancelled',
    'order.returned',
    'product.listed',
    'product.updated',
    'product.delisted',
    'review.submitted',
    'review.updated',
    'customer.inquiry.created',
    'seller.response.submitted',
  ];

  async connect(): Promise<void> {
    try {
      const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
      this.connection = await amqp.connect(rabbitmqUrl);
      this.channel = await this.connection.createChannel();

      // Create exchange
      await this.channel.assertExchange(this.exchangeName, 'topic', {
        durable: true,
      });

      // Create queue
      const queue = await this.channel.assertQueue(this.queueName, {
        durable: true,
        exclusive: false,
      });

      // Bind queue to exchange for subscribed events
      for (const eventType of this.subscribedEvents) {
        await this.channel.bindQueue(queue.queue, this.exchangeName, eventType);
      }

      // Set prefetch to process one message at a time
      await this.channel.prefetch(1);

      // Start consuming messages
      await this.channel.consume(queue.queue, async (msg) => {
        if (msg) {
          await this.handleMessage(msg);
        }
      });

      logger.info('Event consumer connected and listening');
    } catch (error) {
      logger.error('Failed to connect to RabbitMQ:', error);
      throw error;
    }
  }

  private async handleMessage(msg: amqp.Message): Promise<void> {
    try {
      const content = msg.content.toString();
      const event: EventMessage = JSON.parse(content);

      logger.info(`Received event: ${event.eventType} for seller: ${event.sellerId}`);

      // Route event to appropriate handler
      switch (event.eventType) {
        case 'order.created':
          await this.handleOrderCreated(event);
          break;
        case 'order.shipped':
          await this.handleOrderShipped(event);
          break;
        case 'order.delivered':
          await this.handleOrderDelivered(event);
          break;
        case 'order.cancelled':
          await this.handleOrderCancelled(event);
          break;
        case 'order.returned':
          await this.handleOrderReturned(event);
          break;
        case 'product.listed':
        case 'product.updated':
          await this.handleProductUpdate(event);
          break;
        case 'review.submitted':
          await this.handleReviewSubmitted(event);
          break;
        case 'customer.inquiry.created':
          await this.handleCustomerInquiry(event);
          break;
        case 'seller.response.submitted':
          await this.handleSellerResponse(event);
          break;
        default:
          logger.warn(`Unknown event type: ${event.eventType}`);
      }

      // Acknowledge message
      if (this.channel) {
        this.channel.ack(msg);
      }
    } catch (error) {
      logger.error('Error processing message:', error);
      // Reject message and requeue
      if (this.channel) {
        this.channel.nack(msg, false, true);
      }
    }
  }

  private async handleOrderCreated(event: EventMessage): Promise<void> {
    try {
      // Update order metrics in Redis
      const metricsKey = `metrics:${event.sellerId}:orders`;
      await this.incrementMetric(metricsKey, 'total_orders');

      // Store event for later aggregation
      await this.storeEvent(event.sellerId, 'order_events', event);

      // Check if we need to recalculate SQS
      await this.schedulesSQSRecalculation(event.sellerId);
    } catch (error) {
      logger.error('Failed to handle order created event:', error);
      throw error;
    }
  }

  private async handleOrderShipped(event: EventMessage): Promise<void> {
    try {
      const metricsKey = `metrics:${event.sellerId}:shipping`;

      // Calculate shipping time
      const orderCreatedTime = new Date(event.data.orderCreatedAt);
      const shippedTime = new Date(event.timestamp);
      const shippingTime = (shippedTime.getTime() - orderCreatedTime.getTime()) / (1000 * 60 * 60); // hours

      // Update on-time shipping metrics
      const isOnTime = shippingTime <= 24; // Assuming 24 hours is the target
      await this.updateShippingMetrics(event.sellerId, isOnTime);

      await this.storeEvent(event.sellerId, 'shipping_events', event);
    } catch (error) {
      logger.error('Failed to handle order shipped event:', error);
      throw error;
    }
  }

  private async handleOrderDelivered(event: EventMessage): Promise<void> {
    try {
      const metricsKey = `metrics:${event.sellerId}:fulfillment`;
      await this.incrementMetric(metricsKey, 'fulfilled_orders');

      await this.storeEvent(event.sellerId, 'delivery_events', event);
      await this.schedulesSQSRecalculation(event.sellerId);
    } catch (error) {
      logger.error('Failed to handle order delivered event:', error);
      throw error;
    }
  }

  private async handleOrderCancelled(event: EventMessage): Promise<void> {
    try {
      const metricsKey = `metrics:${event.sellerId}:cancellations`;

      // Check if cancelled by seller or customer
      if (event.data.cancelledBy === 'seller') {
        await this.incrementMetric(metricsKey, 'seller_cancellations');
      } else {
        await this.incrementMetric(metricsKey, 'customer_cancellations');
      }

      await this.storeEvent(event.sellerId, 'cancellation_events', event);
      await this.schedulesSQSRecalculation(event.sellerId);
    } catch (error) {
      logger.error('Failed to handle order cancelled event:', error);
      throw error;
    }
  }

  private async handleOrderReturned(event: EventMessage): Promise<void> {
    try {
      const metricsKey = `metrics:${event.sellerId}:returns`;
      await this.incrementMetric(metricsKey, 'total_returns');

      // Track return reason
      if (event.data.reason) {
        await this.incrementMetric(metricsKey, `reason:${event.data.reason}`);
      }

      await this.storeEvent(event.sellerId, 'return_events', event);
      await this.schedulesSQSRecalculation(event.sellerId);
    } catch (error) {
      logger.error('Failed to handle order returned event:', error);
      throw error;
    }
  }

  private async handleProductUpdate(event: EventMessage): Promise<void> {
    try {
      // Trigger catalog quality assessment
      const catalogKey = `metrics:${event.sellerId}:catalog`;

      // Store product update for batch processing
      await this.storeEvent(event.sellerId, 'product_updates', event);

      // Mark catalog metrics as stale
      await redis().setex(`${catalogKey}:stale`, 3600, 'true');

      await this.schedulesSQSRecalculation(event.sellerId);
    } catch (error) {
      logger.error('Failed to handle product update event:', error);
      throw error;
    }
  }

  private async handleReviewSubmitted(event: EventMessage): Promise<void> {
    try {
      const metricsKey = `metrics:${event.sellerId}:reviews`;

      // Update average rating
      const rating = event.data.rating;
      await this.updateAverageRating(event.sellerId, rating);

      // Check if it's a negative review (1-2 stars)
      if (rating <= 2) {
        await this.incrementMetric(metricsKey, 'negative_reviews');
      }

      await this.storeEvent(event.sellerId, 'review_events', event);
      await this.schedulesSQSRecalculation(event.sellerId);
    } catch (error) {
      logger.error('Failed to handle review submitted event:', error);
      throw error;
    }
  }

  private async handleCustomerInquiry(event: EventMessage): Promise<void> {
    try {
      const responseKey = `metrics:${event.sellerId}:response`;

      // Store inquiry timestamp for response time calculation
      await redis().setex(
        `inquiry:${event.data.inquiryId}`,
        86400, // 24 hours TTL
        JSON.stringify({
          sellerId: event.sellerId,
          timestamp: event.timestamp,
        })
      );

      await this.incrementMetric(responseKey, 'pending_inquiries');
    } catch (error) {
      logger.error('Failed to handle customer inquiry event:', error);
      throw error;
    }
  }

  private async handleSellerResponse(event: EventMessage): Promise<void> {
    try {
      const responseKey = `metrics:${event.sellerId}:response`;

      // Calculate response time
      const inquiryData = await redis().get(`inquiry:${event.data.inquiryId}`);
      if (inquiryData) {
        const inquiry = JSON.parse(inquiryData);
        const responseTime =
          (new Date(event.timestamp).getTime() - new Date(inquiry.timestamp).getTime()) /
          (1000 * 60 * 60); // hours

        await this.updateResponseTimeMetrics(event.sellerId, responseTime);
        await redis().del(`inquiry:${event.data.inquiryId}`);
      }

      await this.decrementMetric(responseKey, 'pending_inquiries');
      await this.schedulesSQSRecalculation(event.sellerId);
    } catch (error) {
      logger.error('Failed to handle seller response event:', error);
      throw error;
    }
  }

  private async incrementMetric(key: string, field: string): Promise<void> {
    await redis().hincrby(key, field, 1);
  }

  private async decrementMetric(key: string, field: string): Promise<void> {
    await redis().hincrby(key, field, -1);
  }

  private async updateShippingMetrics(sellerId: string, isOnTime: boolean): Promise<void> {
    const key = `metrics:${sellerId}:shipping`;
    await this.incrementMetric(key, 'total_shipments');
    if (isOnTime) {
      await this.incrementMetric(key, 'on_time_shipments');
    }
  }

  private async updateAverageRating(sellerId: string, newRating: number): Promise<void> {
    const key = `metrics:${sellerId}:reviews`;

    // Get current rating data
    const totalReviews = parseInt(await redis().hget(key, 'total_reviews') || '0');
    const currentSum = parseFloat(await redis().hget(key, 'rating_sum') || '0');

    // Update with new rating
    const newSum = currentSum + newRating;
    const newTotal = totalReviews + 1;
    const newAverage = newSum / newTotal;

    await redis().hset(key, 'total_reviews', newTotal.toString());
    await redis().hset(key, 'rating_sum', newSum.toString());
    await redis().hset(key, 'average_rating', newAverage.toFixed(2));
  }

  private async updateResponseTimeMetrics(sellerId: string, responseTime: number): Promise<void> {
    const key = `metrics:${sellerId}:response`;

    // Get current response time data
    const totalResponses = parseInt(await redis().hget(key, 'total_responses') || '0');
    const currentSum = parseFloat(await redis().hget(key, 'response_time_sum') || '0');

    // Update with new response time
    const newSum = currentSum + responseTime;
    const newTotal = totalResponses + 1;
    const newAverage = newSum / newTotal;

    await redis().hset(key, 'total_responses', newTotal.toString());
    await redis().hset(key, 'response_time_sum', newSum.toString());
    await redis().hset(key, 'average_response_time', newAverage.toFixed(2));
  }

  private async storeEvent(sellerId: string, eventType: string, event: EventMessage): Promise<void> {
    const key = `events:${sellerId}:${eventType}`;
    const value = JSON.stringify(event);

    // Store in a sorted set with timestamp as score
    await redis().zadd(key, Date.now(), value);

    // Set TTL to 30 days
    await redis().expire(key, 30 * 24 * 60 * 60);
  }

  private async schedulesSQSRecalculation(sellerId: string): Promise<void> {
    // Use a debounce mechanism to avoid too frequent recalculations
    const lockKey = `sqs:recalc:lock:${sellerId}`;
    const scheduledKey = `sqs:recalc:scheduled:${sellerId}`;

    // Check if already scheduled
    const isScheduled = await redis().exists(scheduledKey);
    if (isScheduled) {
      return;
    }

    // Schedule recalculation in 5 minutes
    await redis().setex(scheduledKey, 300, 'true');

    // In production, this would publish to a delayed queue
    setTimeout(async () => {
      try {
        await sqsCalculationService.calculateSQSForSeller(sellerId);
        await redis().del(scheduledKey);
      } catch (error) {
        logger.error(`Failed to recalculate SQS for seller ${sellerId}:`, error);
      }
    }, 5 * 60 * 1000);
  }

  async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      logger.info('Event consumer disconnected');
    } catch (error) {
      logger.error('Error disconnecting event consumer:', error);
    }
  }
}

export const eventConsumer = new EventConsumer();