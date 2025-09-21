import { EventEmitter } from 'events';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import * as prometheus from 'prom-client';
import { v4 as uuidv4 } from 'uuid';

const redis = getRedisClient;

// Prometheus metrics
const register = new prometheus.Registry();

// Default metrics
prometheus.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new prometheus.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status', 'service'],
  buckets: [0.1, 5, 15, 50, 100, 500, 1000, 2000, 5000],
});

const httpRequestTotal = new prometheus.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status', 'service'],
});

const businessMetrics = new prometheus.Gauge({
  name: 'business_metrics',
  help: 'Business metrics',
  labelNames: ['type', 'service'],
});

const eventProcessingDuration = new prometheus.Histogram({
  name: 'event_processing_duration_ms',
  help: 'Duration of event processing in ms',
  labelNames: ['event_type', 'service', 'status'],
  buckets: [10, 50, 100, 500, 1000, 5000],
});

const cacheHitRate = new prometheus.Gauge({
  name: 'cache_hit_rate',
  help: 'Cache hit rate percentage',
  labelNames: ['cache_type', 'service'],
});

// Register metrics
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestTotal);
register.registerMetric(businessMetrics);
register.registerMetric(eventProcessingDuration);
register.registerMetric(cacheHitRate);

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  service: string;
  operation: string;
  startTime: number;
  tags: Record<string, any>;
  logs: Array<{
    timestamp: number;
    message: string;
    level: string;
  }>;
}

export interface HealthCheck {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    database: boolean;
    redis: boolean;
    rabbitmq: boolean;
    dependencies: Record<string, boolean>;
  };
  metrics: {
    uptime: number;
    memory: NodeJS.MemoryUsage;
    cpu: number;
  };
}

export class ObservabilityService extends EventEmitter {
  private traces: Map<string, TraceContext[]> = new Map();
  private alerts: Map<string, any> = new Map();
  private readonly serviceName: string;

  constructor(serviceName: string) {
    super();
    this.serviceName = serviceName;
    this.startMetricsCollection();
  }

  // Distributed Tracing
  startTrace(operation: string, parentContext?: Partial<TraceContext>): TraceContext {
    const trace: TraceContext = {
      traceId: parentContext?.traceId || uuidv4(),
      spanId: uuidv4(),
      parentSpanId: parentContext?.spanId,
      service: this.serviceName,
      operation,
      startTime: Date.now(),
      tags: {},
      logs: [],
    };

    // Store trace
    if (!this.traces.has(trace.traceId)) {
      this.traces.set(trace.traceId, []);
    }
    this.traces.get(trace.traceId)!.push(trace);

    // Store in Redis for distributed access
    this.storeTraceInRedis(trace);

    return trace;
  }

  endTrace(trace: TraceContext, error?: Error): void {
    const duration = Date.now() - trace.startTime;

    // Add final log
    trace.logs.push({
      timestamp: Date.now(),
      message: error ? `Error: ${error.message}` : 'Span completed',
      level: error ? 'error' : 'info',
    });

    // Update metrics
    eventProcessingDuration.observe(
      {
        event_type: trace.operation,
        service: this.serviceName,
        status: error ? 'error' : 'success',
      },
      duration
    );

    // Store completed trace
    this.storeCompletedTrace(trace, duration, error);

    // Check for anomalies
    if (duration > 5000) {
      this.createAlert('slow_operation', {
        operation: trace.operation,
        duration,
        traceId: trace.traceId,
      });
    }
  }

  addTraceLog(trace: TraceContext, message: string, level: string = 'info'): void {
    trace.logs.push({
      timestamp: Date.now(),
      message,
      level,
    });
  }

  addTraceTag(trace: TraceContext, key: string, value: any): void {
    trace.tags[key] = value;
  }

  private async storeTraceInRedis(trace: TraceContext): Promise<void> {
    try {
      const key = `trace:${trace.traceId}:${trace.spanId}`;
      await redis().setex(key, 3600, JSON.stringify(trace)); // 1 hour TTL
    } catch (error) {
      logger.error('Failed to store trace:', error);
    }
  }

  private async storeCompletedTrace(trace: TraceContext, duration: number, error?: Error): Promise<void> {
    try {
      const completedTrace = {
        ...trace,
        duration,
        endTime: Date.now(),
        error: error?.message,
        status: error ? 'error' : 'success',
      };

      // Store in time-series format
      const key = `traces:${this.serviceName}:${Math.floor(Date.now() / 60000)}`; // Per minute
      await redis().zadd(key, Date.now(), JSON.stringify(completedTrace));
      await redis().expire(key, 86400); // 24 hours

      // Store in search index
      if (duration > 1000 || error) {
        const searchKey = `traces:slow:${this.serviceName}`;
        await redis().zadd(searchKey, duration, trace.traceId);
        await redis().expire(searchKey, 3600);
      }
    } catch (error) {
      logger.error('Failed to store completed trace:', error);
    }
  }

  // Metrics Collection
  recordHttpRequest(method: string, route: string, status: number, duration: number): void {
    httpRequestDuration.observe(
      { method, route, status: status.toString(), service: this.serviceName },
      duration
    );
    httpRequestTotal.inc({
      method,
      route,
      status: status.toString(),
      service: this.serviceName,
    });
  }

  recordBusinessMetric(type: string, value: number): void {
    businessMetrics.set({ type, service: this.serviceName }, value);
  }

  recordCacheMetrics(hits: number, misses: number, cacheType: string = 'redis'): void {
    const total = hits + misses;
    const hitRate = total > 0 ? (hits / total) * 100 : 0;
    cacheHitRate.set({ cache_type: cacheType, service: this.serviceName }, hitRate);
  }

  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  // Health Checks
  async performHealthCheck(): Promise<HealthCheck> {
    const startTime = process.hrtime();

    const checks = {
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
      rabbitmq: await this.checkRabbitMQ(),
      dependencies: await this.checkDependencies(),
    };

    const isHealthy = Object.values(checks).every(check =>
      typeof check === 'boolean' ? check : Object.values(check).every(v => v)
    );

    const status = isHealthy ? 'healthy' :
      Object.values(checks).some(check =>
        typeof check === 'boolean' ? check : Object.values(check).some(v => v)
      ) ? 'degraded' : 'unhealthy';

    const healthCheck: HealthCheck = {
      service: this.serviceName,
      status,
      checks,
      metrics: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage().user / 1000000, // Convert to seconds
      },
    };

    // Store health status
    await this.storeHealthStatus(healthCheck);

    return healthCheck;
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      // Implementation depends on database client
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await redis().ping();
      return true;
    } catch {
      return false;
    }
  }

  private async checkRabbitMQ(): Promise<boolean> {
    try {
      // Implementation depends on RabbitMQ client
      return true;
    } catch {
      return false;
    }
  }

  private async checkDependencies(): Promise<Record<string, boolean>> {
    const dependencies: Record<string, boolean> = {};

    // Check each dependent service
    const services = ['seller-service', 'review-service', 'loyalty-service'];
    for (const service of services) {
      if (service !== this.serviceName) {
        dependencies[service] = await this.checkServiceHealth(service);
      }
    }

    return dependencies;
  }

  private async checkServiceHealth(serviceName: string): Promise<boolean> {
    try {
      const status = await redis().get(`service:status:${serviceName}`);
      return status === 'healthy';
    } catch {
      return false;
    }
  }

  private async storeHealthStatus(health: HealthCheck): Promise<void> {
    try {
      const key = `health:${this.serviceName}`;
      await redis().setex(key, 60, JSON.stringify(health));

      // Store historical data
      const historyKey = `health:history:${this.serviceName}`;
      await redis().zadd(historyKey, Date.now(), JSON.stringify({
        timestamp: Date.now(),
        status: health.status,
        cpu: health.metrics.cpu,
        memory: health.metrics.memory.heapUsed,
      }));
      await redis().expire(historyKey, 86400); // 24 hours
    } catch (error) {
      logger.error('Failed to store health status:', error);
    }
  }

  // Alerting
  createAlert(type: string, data: any, severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'): void {
    const alert = {
      id: uuidv4(),
      type,
      service: this.serviceName,
      severity,
      data,
      timestamp: Date.now(),
    };

    this.alerts.set(alert.id, alert);
    this.emit('alert', alert);

    // Store in Redis for persistence
    this.storeAlert(alert);

    // Log based on severity
    if (severity === 'critical') {
      logger.error('CRITICAL ALERT:', alert);
    } else if (severity === 'high') {
      logger.warn('HIGH ALERT:', alert);
    } else {
      logger.info('Alert created:', alert);
    }
  }

  private async storeAlert(alert: any): Promise<void> {
    try {
      const key = `alerts:${this.serviceName}:${alert.severity}`;
      await redis().zadd(key, Date.now(), JSON.stringify(alert));
      await redis().expire(key, 604800); // 7 days

      // Also store in a global alerts stream
      await redis().xadd(
        'alerts:stream',
        '*',
        'service', this.serviceName,
        'type', alert.type,
        'severity', alert.severity,
        'data', JSON.stringify(alert.data)
      );
    } catch (error) {
      logger.error('Failed to store alert:', error);
    }
  }

  async getAlerts(severity?: string, limit: number = 100): Promise<any[]> {
    try {
      const key = severity ?
        `alerts:${this.serviceName}:${severity}` :
        `alerts:${this.serviceName}:*`;

      const alerts = await redis().zrevrange(key, 0, limit - 1, 'WITHSCORES');

      const result = [];
      for (let i = 0; i < alerts.length; i += 2) {
        result.push({
          ...JSON.parse(alerts[i]),
          score: parseInt(alerts[i + 1]),
        });
      }

      return result;
    } catch (error) {
      logger.error('Failed to get alerts:', error);
      return [];
    }
  }

  // Logging Integration
  structuredLog(level: string, message: string, metadata: any = {}): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      traceId: process.env.TRACE_ID,
      ...metadata,
    };

    // Log locally
    logger[level](message, logEntry);

    // Ship to centralized logging
    this.shipLog(logEntry);
  }

  private async shipLog(logEntry: any): Promise<void> {
    try {
      // In production, this would send to ELK stack or similar
      const key = `logs:${this.serviceName}:${Math.floor(Date.now() / 60000)}`;
      await redis().zadd(key, Date.now(), JSON.stringify(logEntry));
      await redis().expire(key, 86400); // 24 hours
    } catch (error) {
      // Don't log to avoid infinite loop
      console.error('Failed to ship log:', error);
    }
  }

  // Performance Monitoring
  private startMetricsCollection(): void {
    setInterval(() => {
      // Collect system metrics
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      businessMetrics.set(
        { type: 'memory_heap_used', service: this.serviceName },
        memUsage.heapUsed / 1024 / 1024 // MB
      );

      businessMetrics.set(
        { type: 'cpu_usage', service: this.serviceName },
        cpuUsage.user / 1000000 // Seconds
      );

      // Collect event loop lag
      const start = Date.now();
      setImmediate(() => {
        const lag = Date.now() - start;
        businessMetrics.set(
          { type: 'event_loop_lag', service: this.serviceName },
          lag
        );
      });
    }, 10000); // Every 10 seconds
  }

  // Dashboard Data
  async getDashboardData(): Promise<any> {
    const [health, metrics, recentAlerts, slowTraces] = await Promise.all([
      this.performHealthCheck(),
      this.getServiceMetrics(),
      this.getAlerts('high', 10),
      this.getSlowTraces(10),
    ]);

    return {
      service: this.serviceName,
      health,
      metrics,
      alerts: recentAlerts,
      slowTraces,
      timestamp: Date.now(),
    };
  }

  private async getServiceMetrics(): Promise<any> {
    try {
      const keys = await redis().keys(`metrics:${this.serviceName}:*`);
      const metrics: any = {};

      for (const key of keys) {
        const data = await redis().hgetall(key);
        const metricName = key.split(':').pop();
        metrics[metricName!] = data;
      }

      return metrics;
    } catch (error) {
      logger.error('Failed to get service metrics:', error);
      return {};
    }
  }

  private async getSlowTraces(limit: number): Promise<any[]> {
    try {
      const key = `traces:slow:${this.serviceName}`;
      const traces = await redis().zrevrange(key, 0, limit - 1, 'WITHSCORES');

      const result = [];
      for (let i = 0; i < traces.length; i += 2) {
        result.push({
          traceId: traces[i],
          duration: parseInt(traces[i + 1]),
        });
      }

      return result;
    } catch (error) {
      logger.error('Failed to get slow traces:', error);
      return [];
    }
  }
}

// Singleton instances per service
const observabilityInstances = new Map<string, ObservabilityService>();

export function getObservability(serviceName: string): ObservabilityService {
  if (!observabilityInstances.has(serviceName)) {
    observabilityInstances.set(serviceName, new ObservabilityService(serviceName));
  }
  return observabilityInstances.get(serviceName)!;
}

// Express middleware for automatic request tracking
export function requestTrackingMiddleware(serviceName: string) {
  const observability = getObservability(serviceName);

  return (req: any, res: any, next: any) => {
    const start = Date.now();
    const trace = observability.startTrace(`${req.method} ${req.path}`);

    // Add trace ID to request
    req.traceId = trace.traceId;
    process.env.TRACE_ID = trace.traceId;

    // Override res.end to capture response
    const originalEnd = res.end;
    res.end = function(...args: any[]) {
      const duration = Date.now() - start;

      observability.recordHttpRequest(
        req.method,
        req.route?.path || req.path,
        res.statusCode,
        duration
      );

      observability.endTrace(trace);

      originalEnd.apply(res, args);
    };

    next();
  };
}