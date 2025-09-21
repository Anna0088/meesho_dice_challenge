import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import reviewRoutes from './routes/reviewRoutes';
import moderationRoutes from './routes/moderationRoutes';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { connectRabbitMQ } from './config/rabbitmq';
import { initializeMLModels } from './services/mlModelService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'review-service',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/v1/reviews', reviewRoutes);
app.use('/api/v1/moderation', moderationRoutes);

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

    // Initialize ML models
    await initializeMLModels();
    logger.info('ML models initialized successfully');

    app.listen(PORT, () => {
      logger.info(`Review Service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;