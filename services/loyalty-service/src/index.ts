import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import loyaltyRoutes from './routes/loyaltyRoutes';
import achievementRoutes from './routes/achievementRoutes';
import rewardsRoutes from './routes/rewardsRoutes';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { connectRabbitMQ } from './config/rabbitmq';
import { tierService } from './services/tierService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;

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
    service: 'loyalty-service',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/v1/loyalty', loyaltyRoutes);
app.use('/api/v1/achievements', achievementRoutes);
app.use('/api/v1/rewards', rewardsRoutes);

// Error handling
app.use(errorHandler);

// Cron jobs
function setupCronJobs() {
  // Check tier progression daily at midnight
  cron.schedule('0 0 * * *', async () => {
    logger.info('Running daily tier progression check');
    await tierService.processTierProgressions();
  });

  // Expire points monthly
  cron.schedule('0 0 1 * *', async () => {
    logger.info('Running monthly points expiration');
    await tierService.expireOldPoints();
  });

  // Process achievement milestones hourly
  cron.schedule('0 * * * *', async () => {
    logger.info('Processing achievement milestones');
    await tierService.processAchievementMilestones();
  });

  logger.info('Cron jobs scheduled');
}

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

    // Setup cron jobs
    setupCronJobs();

    app.listen(PORT, () => {
      logger.info(`Loyalty Service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;