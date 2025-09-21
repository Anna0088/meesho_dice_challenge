import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { logger } from '../utils/logger';
import CircuitBreaker from 'opossum';
import { getRedisClient } from '../config/redis';

const redis = getRedisClient;

interface ServiceEndpoint {
  name: string;
  baseUrl: string;
  healthCheck: string;
  timeout: number;
  retries: number;
}

interface ServiceRegistry {
  [key: string]: ServiceEndpoint;
}

export class ServiceMesh {
  private services: ServiceRegistry = {};
  private clients: Map<string, AxiosInstance> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    this.initializeServices();
    this.startHealthChecks();
  }

  private initializeServices(): void {
    this.services = {
      seller: {
        name: 'seller-service',
        baseUrl: process.env.SELLER_SERVICE_URL || 'http://localhost:3001',
        healthCheck: '/health',
        timeout: 5000,
        retries: 3,
      },
      review: {
        name: 'review-service',
        baseUrl: process.env.REVIEW_SERVICE_URL || 'http://localhost:3002',
        healthCheck: '/health',
        timeout: 5000,
        retries: 3,
      },
      loyalty: {
        name: 'loyalty-service',
        baseUrl: process.env.LOYALTY_SERVICE_URL || 'http://localhost:3003',
        healthCheck: '/health',
        timeout: 5000,
        retries: 3,
      },
      analytics: {
        name: 'analytics-service',
        baseUrl: process.env.ANALYTICS_SERVICE_URL || 'http://localhost:3004',
        healthCheck: '/health',
        timeout: 5000,
        retries: 3,
      },
    };

    // Initialize HTTP clients and circuit breakers for each service
    for (const [key, service] of Object.entries(this.services)) {
      this.initializeClient(key, service);
      this.initializeCircuitBreaker(key, service);
    }
  }

  private initializeClient(key: string, service: ServiceEndpoint): void {
    const client = axios.create({
      baseURL: service.baseUrl,
      timeout: service.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor for tracing
    client.interceptors.request.use(
      (config) => {
        // Add trace headers
        config.headers['X-Trace-Id'] = process.env.TRACE_ID || this.generateTraceId();
        config.headers['X-Source-Service'] = process.env.SERVICE_NAME || 'unknown';
        config.headers['X-Request-Time'] = Date.now().toString();

        logger.debug(`Outbound request to ${service.name}`, {
          method: config.method,
          url: config.url,
        });

        return config;
      },
      (error) => {
        logger.error(`Request interceptor error for ${service.name}:`, error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for metrics
    client.interceptors.response.use(
      (response) => {
        const requestTime = parseInt(response.config.headers['X-Request-Time']);
        const duration = Date.now() - requestTime;

        // Record metrics
        this.recordMetrics(service.name, 'success', duration);

        logger.debug(`Response from ${service.name}`, {
          status: response.status,
          duration,
        });

        return response;
      },
      async (error) => {
        const requestTime = parseInt(error.config?.headers['X-Request-Time'] || '0');
        const duration = Date.now() - requestTime;

        // Record metrics
        this.recordMetrics(service.name, 'error', duration);

        // Implement retry logic
        if (error.config && !error.config.__retryCount) {
          error.config.__retryCount = 0;
        }

        if (error.config && error.config.__retryCount < service.retries) {
          error.config.__retryCount++;

          // Exponential backoff
          const delay = Math.pow(2, error.config.__retryCount) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));

          logger.warn(`Retrying request to ${service.name} (attempt ${error.config.__retryCount})`);
          return client.request(error.config);
        }

        logger.error(`Request to ${service.name} failed:`, error.message);
        return Promise.reject(error);
      }
    );

    this.clients.set(key, client);
  }

  private initializeCircuitBreaker(key: string, service: ServiceEndpoint): void {
    const options = {
      timeout: service.timeout,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      rollingCountTimeout: 10000,
      rollingCountBuckets: 10,
      name: service.name,
    };

    const breaker = new CircuitBreaker(this.makeRequest.bind(this), options);

    // Circuit breaker events
    breaker.on('open', () => {
      logger.warn(`Circuit breaker opened for ${service.name}`);
      this.notifyServiceDown(service.name);
    });

    breaker.on('halfOpen', () => {
      logger.info(`Circuit breaker half-open for ${service.name}`);
    });

    breaker.on('close', () => {
      logger.info(`Circuit breaker closed for ${service.name}`);
      this.notifyServiceUp(service.name);
    });

    this.circuitBreakers.set(key, breaker);
  }

  private async makeRequest(config: AxiosRequestConfig, serviceKey: string): Promise<AxiosResponse> {
    const client = this.clients.get(serviceKey);
    if (!client) {
      throw new Error(`No client found for service: ${serviceKey}`);
    }
    return client.request(config);
  }

  // Public API for making requests
  async request(
    serviceKey: string,
    config: AxiosRequestConfig
  ): Promise<AxiosResponse> {
    const breaker = this.circuitBreakers.get(serviceKey);
    if (!breaker) {
      throw new Error(`No circuit breaker found for service: ${serviceKey}`);
    }

    try {
      return await breaker.fire(config, serviceKey);
    } catch (error) {
      if (breaker.opened) {
        // Circuit is open, try fallback
        return this.handleFallback(serviceKey, config);
      }
      throw error;
    }
  }

  // Convenience methods for common HTTP verbs
  async get(serviceKey: string, path: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.request(serviceKey, { ...config, method: 'GET', url: path });
  }

  async post(serviceKey: string, path: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.request(serviceKey, { ...config, method: 'POST', url: path, data });
  }

  async put(serviceKey: string, path: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.request(serviceKey, { ...config, method: 'PUT', url: path, data });
  }

  async delete(serviceKey: string, path: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.request(serviceKey, { ...config, method: 'DELETE', url: path });
  }

  // Health check implementation
  private startHealthChecks(): void {
    for (const [key, service] of Object.entries(this.services)) {
      const interval = setInterval(async () => {
        try {
          const client = this.clients.get(key);
          if (client) {
            await client.get(service.healthCheck, { timeout: 2000 });
            await this.updateServiceStatus(service.name, 'healthy');
          }
        } catch (error) {
          logger.warn(`Health check failed for ${service.name}`);
          await this.updateServiceStatus(service.name, 'unhealthy');
        }
      }, 30000); // Check every 30 seconds

      this.healthCheckIntervals.set(key, interval);
    }
  }

  private async updateServiceStatus(serviceName: string, status: string): Promise<void> {
    const key = `service:status:${serviceName}`;
    await redis().setex(key, 60, status);
  }

  async getServiceStatus(serviceName: string): Promise<string> {
    const key = `service:status:${serviceName}`;
    return await redis().get(key) || 'unknown';
  }

  // Fallback handling
  private async handleFallback(serviceKey: string, config: AxiosRequestConfig): Promise<AxiosResponse> {
    logger.warn(`Using fallback for ${serviceKey}`);

    // Check if we have cached response
    const cacheKey = this.getCacheKey(serviceKey, config);
    const cached = await redis().get(cacheKey);

    if (cached) {
      logger.info(`Returning cached response for ${serviceKey}`);
      return {
        data: JSON.parse(cached),
        status: 200,
        statusText: 'OK (Cached)',
        headers: {},
        config,
      };
    }

    // Return default fallback response
    return {
      data: { error: 'Service temporarily unavailable', fallback: true },
      status: 503,
      statusText: 'Service Unavailable',
      headers: {},
      config,
    };
  }

  private getCacheKey(serviceKey: string, config: AxiosRequestConfig): string {
    const { method = 'GET', url = '', params = {}, data = {} } = config;
    const paramStr = JSON.stringify(params);
    const dataStr = JSON.stringify(data);
    return `cache:${serviceKey}:${method}:${url}:${paramStr}:${dataStr}`;
  }

  // Metrics recording
  private async recordMetrics(serviceName: string, status: string, duration: number): Promise<void> {
    try {
      // Record to Redis for real-time metrics
      const metricsKey = `metrics:${serviceName}:${status}`;
      await redis().hincrby(metricsKey, 'count', 1);
      await redis().hincrby(metricsKey, 'total_duration', duration);

      // Set TTL
      await redis().expire(metricsKey, 3600); // 1 hour

      // Record percentiles
      const percentileKey = `metrics:${serviceName}:percentiles`;
      await redis().zadd(percentileKey, duration, Date.now());
      await redis().expire(percentileKey, 3600);
    } catch (error) {
      logger.error('Failed to record metrics:', error);
    }
  }

  async getMetrics(serviceName: string): Promise<any> {
    try {
      const [success, error] = await Promise.all([
        redis().hgetall(`metrics:${serviceName}:success`),
        redis().hgetall(`metrics:${serviceName}:error`),
      ]);

      const successCount = parseInt(success?.count || '0');
      const errorCount = parseInt(error?.count || '0');
      const totalCount = successCount + errorCount;

      return {
        totalRequests: totalCount,
        successCount,
        errorCount,
        successRate: totalCount > 0 ? (successCount / totalCount) * 100 : 0,
        averageLatency: successCount > 0 ?
          parseInt(success?.total_duration || '0') / successCount : 0,
      };
    } catch (error) {
      logger.error('Failed to get metrics:', error);
      return null;
    }
  }

  // Service discovery
  async discoverService(serviceName: string): Promise<string | null> {
    try {
      // In production, this would integrate with service discovery tools like Consul or Kubernetes
      // For now, return from configuration
      const service = Object.values(this.services).find(s => s.name === serviceName);
      return service?.baseUrl || null;
    } catch (error) {
      logger.error(`Failed to discover service ${serviceName}:`, error);
      return null;
    }
  }

  // Load balancing (round-robin example)
  private instanceIndex: Map<string, number> = new Map();

  async getNextInstance(serviceName: string): Promise<string> {
    // In production, this would return different instances
    // For now, return the single configured instance
    return this.services[serviceName]?.baseUrl || '';
  }

  // Notifications
  private async notifyServiceDown(serviceName: string): Promise<void> {
    // Send notification to monitoring system
    logger.error(`SERVICE DOWN: ${serviceName}`);
    // In production, integrate with PagerDuty, Slack, etc.
  }

  private async notifyServiceUp(serviceName: string): Promise<void> {
    logger.info(`SERVICE UP: ${serviceName}`);
  }

  // Cleanup
  destroy(): void {
    for (const interval of this.healthCheckIntervals.values()) {
      clearInterval(interval);
    }
    this.healthCheckIntervals.clear();
  }

  private generateTraceId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
let serviceMeshInstance: ServiceMesh | null = null;

export function getServiceMesh(): ServiceMesh {
  if (!serviceMeshInstance) {
    serviceMeshInstance = new ServiceMesh();
  }
  return serviceMeshInstance;
}