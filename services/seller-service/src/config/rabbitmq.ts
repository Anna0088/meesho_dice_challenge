import amqp from 'amqplib';
import { logger } from '../utils/logger';
import { eventConsumer } from '../events/eventConsumer';

let connection: amqp.Connection | null = null;

export async function connectRabbitMQ(): Promise<void> {
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    connection = await amqp.connect(rabbitmqUrl);

    connection.on('error', (err) => {
      logger.error('RabbitMQ connection error:', err);
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed, attempting to reconnect...');
      setTimeout(connectRabbitMQ, 5000);
    });

    // Start event consumer
    await eventConsumer.connect();

    logger.info('RabbitMQ connected successfully');
  } catch (error) {
    logger.error('Failed to connect to RabbitMQ:', error);
    throw error;
  }
}

export function getRabbitMQConnection(): amqp.Connection | null {
  return connection;
}

export async function disconnectRabbitMQ(): Promise<void> {
  try {
    await eventConsumer.disconnect();
    if (connection) {
      await connection.close();
    }
    logger.info('RabbitMQ disconnected');
  } catch (error) {
    logger.error('Error disconnecting RabbitMQ:', error);
  }
}