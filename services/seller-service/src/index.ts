import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import sellerRoutes from './routes/sellerRoutes';
import verificationRoutes from './routes/verificationRoutes';
import sqsRoutes from './routes/sqsRoutes';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { connectRabbitMQ } from './config/rabbitmq';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', service: 'seller-service' });
});

// Routes
app.use('/api/v1/sellers', sellerRoutes);
app.use('/api/v1/verification', verificationRoutes);
app.use('/api/v1/sqs', sqsRoutes);

// Error handling
app.use(errorHandler);

// Start server
async function startServer(): Promise<void> {
  try {
    // Connect to databases
    await connectDatabase();
    logger.info('Database connected successfully');

    // Connect to Redis
    await connectRedis();
    logger.info('Redis connected successfully');

    // Connect to RabbitMQ
    await connectRabbitMQ();
    logger.info('RabbitMQ connected successfully');

    app.listen(PORT, () => {
      logger.info(`Seller Service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;