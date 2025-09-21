import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logger } from './utils/logger';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';

dotenv.config();

const app = express();
const PORT = process.env.GATEWAY_PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.',
});
app.use(limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
  });
});

// Service routes configuration
const services = {
  seller: {
    target: `http://localhost:${process.env.SELLER_SERVICE_PORT || 3001}`,
    changeOrigin: true,
  },
  review: {
    target: `http://localhost:${process.env.REVIEW_SERVICE_PORT || 3002}`,
    changeOrigin: true,
  },
  loyalty: {
    target: `http://localhost:${process.env.LOYALTY_SERVICE_PORT || 3003}`,
    changeOrigin: true,
  },
  analytics: {
    target: `http://localhost:${process.env.ANALYTICS_SERVICE_PORT || 3004}`,
    changeOrigin: true,
  },
};

// Proxy routes
app.use(
  '/api/v1/sellers',
  authMiddleware,
  createProxyMiddleware({
    target: services.seller.target,
    changeOrigin: services.seller.changeOrigin,
    pathRewrite: { '^/api/v1/sellers': '/api/v1/sellers' },
    onError: (err, req, res) => {
      logger.error('Seller service proxy error:', err);
      res.status(502).json({ error: 'Service temporarily unavailable' });
    },
  })
);

app.use(
  '/api/v1/reviews',
  authMiddleware,
  createProxyMiddleware({
    target: services.review.target,
    changeOrigin: services.review.changeOrigin,
    pathRewrite: { '^/api/v1/reviews': '/api/v1/reviews' },
    onError: (err, req, res) => {
      logger.error('Review service proxy error:', err);
      res.status(502).json({ error: 'Service temporarily unavailable' });
    },
  })
);

app.use(
  '/api/v1/loyalty',
  authMiddleware,
  createProxyMiddleware({
    target: services.loyalty.target,
    changeOrigin: services.loyalty.changeOrigin,
    pathRewrite: { '^/api/v1/loyalty': '/api/v1/loyalty' },
    onError: (err, req, res) => {
      logger.error('Loyalty service proxy error:', err);
      res.status(502).json({ error: 'Service temporarily unavailable' });
    },
  })
);

app.use(
  '/api/v1/analytics',
  authMiddleware,
  createProxyMiddleware({
    target: services.analytics.target,
    changeOrigin: services.analytics.changeOrigin,
    pathRewrite: { '^/api/v1/analytics': '/api/v1/analytics' },
    onError: (err, req, res) => {
      logger.error('Analytics service proxy error:', err);
      res.status(502).json({ error: 'Service temporarily unavailable' });
    },
  })
);

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`API Gateway running on port ${PORT}`);
  logger.info('Proxying to services:', services);
});

export default app;