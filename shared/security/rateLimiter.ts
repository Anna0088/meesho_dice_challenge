import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const redis = getRedisClient;

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  handler?: (req: Request, res: Response) => void;
  skip?: (req: Request) => boolean;
  requestWeightFn?: (req: Request) => number;
}

export interface ThrottleConfig {
  burstLimit: number;
  sustainedLimit: number;
  windowMs: number;
  keyPrefix?: string;
}

export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly buckets: Map<string, TokenBucket> = new Map();

  constructor(config: RateLimitConfig) {
    this.config = {
      keyPrefix: 'rate-limit',
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      keyGenerator: this.defaultKeyGenerator,
      handler: this.defaultHandler,
      requestWeightFn: () => 1,
      ...config,
    };
  }

  async isAllowed(key: string, weight: number = 1): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
    retryAfter?: number;
  }> {
    const redisKey = `${this.config.keyPrefix}:${key}`;
    const now = Date.now();
    const window = Math.floor(now / this.config.windowMs);
    const windowKey = `${redisKey}:${window}`;

    try {
      // Increment counter with weight
      const count = await redis().incrby(windowKey, weight);
      
      // Set expiry on first request in window
      if (count === weight) {
        await redis().expire(windowKey, Math.ceil(this.config.windowMs / 1000));
      }

      const allowed = count <= this.config.maxRequests;
      const remaining = Math.max(0, this.config.maxRequests - count);
      const resetAt = (window + 1) * this.config.windowMs;
      
      if (!allowed) {
        const retryAfter = resetAt - now;
        return { allowed, remaining, resetAt, retryAfter };
      }

      return { allowed, remaining, resetAt };
    } catch (error) {
      logger.error('Rate limiter error:', error);
      // Fail open - allow request on error
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetAt: now + this.config.windowMs,
      };
    }
  }

  middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Check if should skip
      if (this.config.skip && this.config.skip(req)) {
        return next();
      }

      const key = this.config.keyGenerator!(req);
      const weight = this.config.requestWeightFn!(req);
      const result = await this.isAllowed(key, weight);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', this.config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());

      if (!result.allowed) {
        res.setHeader('Retry-After', Math.ceil(result.retryAfter! / 1000));
        
        if (this.config.handler) {
          return this.config.handler(req, res);
        }
        
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          retryAfter: result.retryAfter,
        });
      }

      // Track response for conditional limiting
      if (this.config.skipSuccessfulRequests || this.config.skipFailedRequests) {
        const originalEnd = res.end;
        res.end = function(...args: any[]) {
          const shouldRefund = 
            (res.statusCode < 400 && this.config.skipSuccessfulRequests) ||
            (res.statusCode >= 400 && this.config.skipFailedRequests);
          
          if (shouldRefund) {
            // Refund the request weight
            redis().decrby(`${this.config.keyPrefix}:${key}:${Math.floor(Date.now() / this.config.windowMs)}`, weight);
          }
          
          return originalEnd.apply(res, args);
        }.bind(this);
      }

      next();
    };
  }

  private defaultKeyGenerator(req: Request): string {
    // Use IP + user ID if authenticated
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userId = (req as any).user?.id || 'anonymous';
    return `${ip}:${userId}`;
  }

  private defaultHandler(req: Request, res: Response): void {
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'You have exceeded the rate limit. Please try again later.',
    });
  }
}

// Token Bucket implementation for smoother rate limiting
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number;

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(tokens: number = 1): boolean {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = (timePassed / 1000) * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }
}

export class DistributedThrottler {
  private readonly config: ThrottleConfig;

  constructor(config: ThrottleConfig) {
    this.config = {
      keyPrefix: 'throttle',
      ...config,
    };
  }

  async isAllowed(key: string, cost: number = 1): Promise<{
    allowed: boolean;
    tokensRemaining: number;
    retryAfter?: number;
  }> {
    const redisKey = `${this.config.keyPrefix}:${key}`;
    const now = Date.now();
    
    try {
      // Lua script for atomic token bucket operations
      const luaScript = `
        local key = KEYS[1]
        local burst_limit = tonumber(ARGV[1])
        local sustained_limit = tonumber(ARGV[2])
        local window_ms = tonumber(ARGV[3])
        local cost = tonumber(ARGV[4])
        local now = tonumber(ARGV[5])
        
        local data = redis.call('HMGET', key, 'tokens', 'last_refill')
        local tokens = tonumber(data[1]) or burst_limit
        local last_refill = tonumber(data[2]) or now
        
        -- Refill tokens based on time passed
        local time_passed = now - last_refill
        local refill_rate = sustained_limit / (window_ms / 1000)
        local new_tokens = math.min(burst_limit, tokens + (time_passed / 1000) * refill_rate)
        
        if new_tokens >= cost then
          new_tokens = new_tokens - cost
          redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
          redis.call('EXPIRE', key, window_ms / 1000)
          return {1, new_tokens}
        else
          redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
          redis.call('EXPIRE', key, window_ms / 1000)
          return {0, new_tokens}
        end
      `;

      const result = await redis().eval(
        luaScript,
        1,
        redisKey,
        this.config.burstLimit,
        this.config.sustainedLimit,
        this.config.windowMs,
        cost,
        now
      ) as [number, number];

      const [allowed, tokensRemaining] = result;
      
      if (!allowed) {
        const refillRate = this.config.sustainedLimit / (this.config.windowMs / 1000);
        const retryAfter = ((cost - tokensRemaining) / refillRate) * 1000;
        
        return {
          allowed: false,
          tokensRemaining,
          retryAfter,
        };
      }

      return {
        allowed: true,
        tokensRemaining,
      };
    } catch (error) {
      logger.error('Throttler error:', error);
      // Fail open
      return {
        allowed: true,
        tokensRemaining: this.config.burstLimit,
      };
    }
  }

  middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const key = this.generateKey(req);
      const cost = this.calculateCost(req);
      const result = await this.isAllowed(key, cost);

      // Set throttle headers
      res.setHeader('X-Throttle-Limit', this.config.burstLimit);
      res.setHeader('X-Throttle-Remaining', Math.floor(result.tokensRemaining));

      if (!result.allowed) {
        res.setHeader('Retry-After', Math.ceil(result.retryAfter! / 1000));
        
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Request rate exceeded. Please slow down.',
          retryAfter: result.retryAfter,
        });
      }

      next();
    };
  }

  private generateKey(req: Request): string {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userId = (req as any).user?.id;
    return userId ? `user:${userId}` : `ip:${ip}`;
  }

  private calculateCost(req: Request): number {
    // Different costs for different operations
    const method = req.method;
    const path = req.path;

    if (method === 'GET') return 1;
    if (method === 'POST' && path.includes('/upload')) return 10;
    if (method === 'POST') return 5;
    if (method === 'PUT' || method === 'PATCH') return 3;
    if (method === 'DELETE') return 2;
    
    return 1;
  }
}

// Advanced rate limiting strategies
export class AdaptiveRateLimiter {
  private readonly baseConfig: RateLimitConfig;
  private performanceMetrics: Map<string, PerformanceMetric> = new Map();

  constructor(baseConfig: RateLimitConfig) {
    this.baseConfig = baseConfig;
    this.startMetricsCollection();
  }

  async getDynamicLimit(key: string): Promise<number> {
    const metrics = this.performanceMetrics.get(key);
    
    if (!metrics) {
      return this.baseConfig.maxRequests;
    }

    // Adjust limit based on user behavior
    const errorRate = metrics.errors / metrics.total;
    const avgResponseTime = metrics.totalResponseTime / metrics.total;

    let limit = this.baseConfig.maxRequests;

    // Reduce limit for high error rates
    if (errorRate > 0.1) {
      limit = Math.floor(limit * 0.5);
    } else if (errorRate > 0.05) {
      limit = Math.floor(limit * 0.75);
    }

    // Increase limit for good behavior
    if (errorRate < 0.01 && avgResponseTime < 100) {
      limit = Math.floor(limit * 1.5);
    }

    return limit;
  }

  middleware() {
    const rateLimiter = new RateLimiter(this.baseConfig);

    return async (req: Request, res: Response, next: NextFunction) => {
      const key = this.baseConfig.keyGenerator!(req);
      const dynamicLimit = await this.getDynamicLimit(key);

      // Update rate limiter with dynamic limit
      const dynamicConfig = {
        ...this.baseConfig,
        maxRequests: dynamicLimit,
      };

      const dynamicLimiter = new RateLimiter(dynamicConfig);
      return dynamicLimiter.middleware()(req, res, next);
    };
  }

  private startMetricsCollection(): void {
    // Collect metrics every minute
    setInterval(() => {
      // Clean old metrics
      for (const [key, metrics] of this.performanceMetrics) {
        if (Date.now() - metrics.lastUpdate > 3600000) {
          this.performanceMetrics.delete(key);
        }
      }
    }, 60000);
  }

  recordMetric(key: string, responseTime: number, statusCode: number): void {
    if (!this.performanceMetrics.has(key)) {
      this.performanceMetrics.set(key, {
        total: 0,
        errors: 0,
        totalResponseTime: 0,
        lastUpdate: Date.now(),
      });
    }

    const metrics = this.performanceMetrics.get(key)!;
    metrics.total++;
    metrics.totalResponseTime += responseTime;
    if (statusCode >= 400) {
      metrics.errors++;
    }
    metrics.lastUpdate = Date.now();
  }
}

interface PerformanceMetric {
  total: number;
  errors: number;
  totalResponseTime: number;
  lastUpdate: number;
}

// Distributed rate limiting with sliding window
export class SlidingWindowRateLimiter {
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  async isAllowed(key: string): Promise<boolean> {
    const redisKey = `sliding:${key}`;
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    try {
      // Remove old entries and count current window
      const pipeline = redis().pipeline();
      pipeline.zremrangebyscore(redisKey, '-inf', windowStart);
      pipeline.zadd(redisKey, now, `${now}:${crypto.randomBytes(4).toString('hex')}`);
      pipeline.zcount(redisKey, windowStart, now);
      pipeline.expire(redisKey, Math.ceil(this.config.windowMs / 1000));
      
      const results = await pipeline.exec();
      const count = results?.[2]?.[1] as number || 0;
      
      return count <= this.config.maxRequests;
    } catch (error) {
      logger.error('Sliding window rate limiter error:', error);
      return true; // Fail open
    }
  }
}

// Pre-configured rate limiters
export const rateLimiters = {
  // Strict limit for authentication endpoints
  auth: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    keyPrefix: 'auth',
    skipSuccessfulRequests: true,
  }),

  // Standard API limit
  api: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    keyPrefix: 'api',
  }),

  // Relaxed limit for static content
  static: new RateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 1000,
    keyPrefix: 'static',
  }),

  // Upload limit
  upload: new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10,
    keyPrefix: 'upload',
    requestWeightFn: (req) => {
      // Weight based on file size
      const size = parseInt(req.headers['content-length'] || '0');
      return Math.ceil(size / (1024 * 1024)); // 1 weight per MB
    },
  }),
};

// Throttlers for smooth traffic shaping
export const throttlers = {
  // API throttling
  api: new DistributedThrottler({
    burstLimit: 20,
    sustainedLimit: 100,
    windowMs: 60000,
  }),

  // Heavy operations throttling
  heavy: new DistributedThrottler({
    burstLimit: 5,
    sustainedLimit: 10,
    windowMs: 60000,
  }),
};