import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { createHash } from 'crypto';
import LRU from 'lru-cache';

const redis = getRedisClient;

interface CacheConfig {
  ttl: number;
  maxSize?: number;
  staleWhileRevalidate?: boolean;
  compression?: boolean;
}

interface QueryOptimization {
  useIndexes: string[];
  batchSize: number;
  parallel: boolean;
  cacheStrategy: 'aggressive' | 'moderate' | 'minimal';
}

export class PerformanceOptimizer {
  private localCache: LRU<string, any>;
  private cacheStats = {
    hits: 0,
    misses: 0,
    updates: 0,
    evictions: 0,
  };

  constructor() {
    // Initialize local LRU cache
    this.localCache = new LRU({
      max: 1000, // Maximum items
      ttl: 1000 * 60 * 5, // 5 minutes default TTL
      updateAgeOnGet: true,
      updateAgeOnHas: true,
      dispose: (key, value) => {
        this.cacheStats.evictions++;
      },
    });
  }

  // Multi-layer caching strategy
  async cache<T>(
    key: string,
    fetcher: () => Promise<T>,
    config: CacheConfig = { ttl: 300 }
  ): Promise<T> {
    const cacheKey = this.generateCacheKey(key);

    // Check L1 cache (local memory)
    const localCached = this.localCache.get(cacheKey);
    if (localCached !== undefined) {
      this.cacheStats.hits++;
      logger.debug(`L1 cache hit for ${key}`);
      return localCached;
    }

    // Check L2 cache (Redis)
    try {
      const redisCached = await redis().get(cacheKey);
      if (redisCached) {
        this.cacheStats.hits++;
        logger.debug(`L2 cache hit for ${key}`);

        const value = this.deserialize(redisCached);
        // Update L1 cache
        this.localCache.set(cacheKey, value);
        return value;
      }
    } catch (error) {
      logger.warn('Redis cache read failed:', error);
    }

    // Cache miss - fetch from source
    this.cacheStats.misses++;
    logger.debug(`Cache miss for ${key}`);

    try {
      const value = await fetcher();

      // Update both cache layers
      await this.updateCaches(cacheKey, value, config);

      return value;
    } catch (error) {
      // Check for stale data if staleWhileRevalidate is enabled
      if (config.staleWhileRevalidate) {
        const staleData = await this.getStaleData(cacheKey);
        if (staleData) {
          logger.warn(`Returning stale data for ${key} due to fetch error`);
          return staleData;
        }
      }
      throw error;
    }
  }

  private async updateCaches(key: string, value: any, config: CacheConfig): Promise<void> {
    this.cacheStats.updates++;

    // Update L1 cache
    this.localCache.set(key, value);

    // Update L2 cache
    try {
      const serialized = this.serialize(value, config.compression);
      await redis().setex(key, config.ttl, serialized);

      // Store stale copy if staleWhileRevalidate is enabled
      if (config.staleWhileRevalidate) {
        await redis().setex(`${key}:stale`, config.ttl * 2, serialized);
      }
    } catch (error) {
      logger.error('Failed to update Redis cache:', error);
    }
  }

  async invalidate(pattern: string): Promise<void> {
    // Invalidate L1 cache
    for (const key of this.localCache.keys()) {
      if (key.includes(pattern)) {
        this.localCache.delete(key);
      }
    }

    // Invalidate L2 cache
    try {
      const keys = await redis().keys(`*${pattern}*`);
      if (keys.length > 0) {
        await redis().del(...keys);
      }
      logger.info(`Invalidated ${keys.length} cache entries matching ${pattern}`);
    } catch (error) {
      logger.error('Failed to invalidate Redis cache:', error);
    }
  }

  // Query optimization
  optimizeQuery(query: string, context: any = {}): QueryOptimization {
    const optimization: QueryOptimization = {
      useIndexes: [],
      batchSize: 100,
      parallel: false,
      cacheStrategy: 'moderate',
    };

    // Analyze query patterns
    if (query.includes('WHERE') || query.includes('where')) {
      optimization.useIndexes = this.suggestIndexes(query);
    }

    // Determine batch size based on data volume
    if (context.estimatedRows > 10000) {
      optimization.batchSize = 1000;
      optimization.parallel = true;
    } else if (context.estimatedRows > 1000) {
      optimization.batchSize = 500;
    }

    // Determine cache strategy
    if (context.isFrequentlyAccessed) {
      optimization.cacheStrategy = 'aggressive';
    } else if (context.isRarelyModified) {
      optimization.cacheStrategy = 'moderate';
    } else {
      optimization.cacheStrategy = 'minimal';
    }

    return optimization;
  }

  private suggestIndexes(query: string): string[] {
    const indexes: string[] = [];
    const whereClause = query.match(/WHERE\s+(.+?)(?:GROUP|ORDER|LIMIT|$)/i);

    if (whereClause) {
      const conditions = whereClause[1];

      // Extract column names from conditions
      const columns = conditions.match(/(\w+)\s*[=<>]/g);
      if (columns) {
        columns.forEach(col => {
          const columnName = col.replace(/[=<>\s]/g, '');
          indexes.push(columnName);
        });
      }
    }

    return [...new Set(indexes)]; // Remove duplicates
  }

  // Batch processing optimization
  async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options: {
      batchSize?: number;
      parallel?: boolean;
      maxConcurrency?: number;
    } = {}
  ): Promise<R[]> {
    const {
      batchSize = 100,
      parallel = false,
      maxConcurrency = 10,
    } = options;

    const results: R[] = [];

    if (parallel) {
      // Process in parallel batches
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchPromises = batch.map((item, index) =>
          this.withConcurrencyLimit(
            () => processor(item),
            Math.floor(index / maxConcurrency)
          )
        );

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }
    } else {
      // Process sequentially
      for (const item of items) {
        results.push(await processor(item));
      }
    }

    return results;
  }

  private async withConcurrencyLimit<T>(
    fn: () => Promise<T>,
    delay: number
  ): Promise<T> {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay * 100));
    }
    return fn();
  }

  // Database connection pooling
  getOptimalPoolSize(context: {
    maxConnections: number;
    avgQueryTime: number;
    requestsPerSecond: number;
  }): number {
    // Little's Law: L = λW
    // L = average number of connections needed
    // λ = arrival rate (requests/second)
    // W = average time in system (seconds)

    const avgConnectionsNeeded = context.requestsPerSecond * (context.avgQueryTime / 1000);
    const optimalSize = Math.min(
      Math.ceil(avgConnectionsNeeded * 1.5), // 50% buffer
      context.maxConnections
    );

    return Math.max(optimalSize, 5); // Minimum 5 connections
  }

  // Response compression
  async compressResponse(data: any, acceptEncoding: string = ''): Promise<Buffer | string> {
    const dataStr = JSON.stringify(data);

    if (dataStr.length < 1000) {
      // Don't compress small responses
      return dataStr;
    }

    if (acceptEncoding.includes('gzip')) {
      const zlib = require('zlib');
      return zlib.gzipSync(dataStr);
    } else if (acceptEncoding.includes('br')) {
      const zlib = require('zlib');
      return zlib.brotliCompressSync(dataStr);
    }

    return dataStr;
  }

  // Lazy loading strategy
  createLazyLoader<T>(
    loader: (id: string) => Promise<T>,
    options: { preload?: string[]; ttl?: number } = {}
  ) {
    const cache = new Map<string, Promise<T>>();

    // Preload specified items
    if (options.preload) {
      for (const id of options.preload) {
        cache.set(id, loader(id));
      }
    }

    return {
      get: async (id: string): Promise<T> => {
        if (!cache.has(id)) {
          cache.set(id, loader(id));
        }
        return cache.get(id)!;
      },

      preload: (ids: string[]) => {
        for (const id of ids) {
          if (!cache.has(id)) {
            cache.set(id, loader(id));
          }
        }
      },

      clear: (id?: string) => {
        if (id) {
          cache.delete(id);
        } else {
          cache.clear();
        }
      },
    };
  }

  // Pagination optimization
  optimizePagination(params: {
    totalItems: number;
    requestedPage: number;
    requestedPageSize: number;
  }): {
    page: number;
    pageSize: number;
    offset: number;
    prefetchNext: boolean;
  } {
    // Optimize page size based on total items
    let optimalPageSize = params.requestedPageSize;

    if (params.totalItems > 10000) {
      // For large datasets, limit page size
      optimalPageSize = Math.min(params.requestedPageSize, 100);
    } else if (params.totalItems < 100) {
      // For small datasets, can use larger page size
      optimalPageSize = Math.min(params.requestedPageSize, 50);
    }

    const page = Math.max(1, params.requestedPage);
    const offset = (page - 1) * optimalPageSize;

    // Determine if we should prefetch next page
    const isLastPage = offset + optimalPageSize >= params.totalItems;
    const prefetchNext = !isLastPage && page <= 5; // Prefetch for first 5 pages

    return {
      page,
      pageSize: optimalPageSize,
      offset,
      prefetchNext,
    };
  }

  // Memory optimization
  async optimizeMemoryUsage(): Promise<void> {
    // Clear local cache if memory usage is high
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    if (heapUsedPercent > 80) {
      logger.warn(`High memory usage detected: ${heapUsedPercent.toFixed(2)}%`);

      // Clear half of local cache
      const keysToRemove = Math.floor(this.localCache.size / 2);
      let removed = 0;

      for (const key of this.localCache.keys()) {
        if (removed >= keysToRemove) break;
        this.localCache.delete(key);
        removed++;
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      logger.info(`Cleared ${removed} cache entries to free memory`);
    }
  }

  // Helper methods
  private generateCacheKey(key: string): string {
    return `cache:${createHash('md5').update(key).digest('hex')}`;
  }

  private serialize(value: any, compress: boolean = false): string {
    const str = JSON.stringify(value);
    if (compress && str.length > 1000) {
      const zlib = require('zlib');
      return zlib.gzipSync(str).toString('base64');
    }
    return str;
  }

  private deserialize(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      // Might be compressed
      try {
        const zlib = require('zlib');
        const decompressed = zlib.gunzipSync(Buffer.from(value, 'base64')).toString();
        return JSON.parse(decompressed);
      } catch {
        return value;
      }
    }
  }

  private async getStaleData(key: string): Promise<any> {
    try {
      const staleData = await redis().get(`${key}:stale`);
      if (staleData) {
        return this.deserialize(staleData);
      }
    } catch (error) {
      logger.error('Failed to get stale data:', error);
    }
    return null;
  }

  // Get cache statistics
  getCacheStats() {
    const hitRate = this.cacheStats.hits /
      (this.cacheStats.hits + this.cacheStats.misses) * 100 || 0;

    return {
      ...this.cacheStats,
      hitRate: hitRate.toFixed(2) + '%',
      localCacheSize: this.localCache.size,
      localCacheMaxSize: this.localCache.max,
    };
  }

  // Reset cache statistics
  resetStats(): void {
    this.cacheStats = {
      hits: 0,
      misses: 0,
      updates: 0,
      evictions: 0,
    };
  }
}

// Singleton instance
let performanceOptimizer: PerformanceOptimizer | null = null;

export function getPerformanceOptimizer(): PerformanceOptimizer {
  if (!performanceOptimizer) {
    performanceOptimizer = new PerformanceOptimizer();
  }
  return performanceOptimizer;
}

// Express middleware for automatic response caching
export function responseCachingMiddleware(options: {
  ttl?: number;
  keyGenerator?: (req: any) => string;
} = {}) {
  const optimizer = getPerformanceOptimizer();
  const { ttl = 60, keyGenerator } = options;

  return async (req: any, res: any, next: any) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const cacheKey = keyGenerator ?
      keyGenerator(req) :
      `${req.path}:${JSON.stringify(req.query)}`;

    try {
      const cached = await optimizer.cache(
        cacheKey,
        async () => {
          // Capture response
          return new Promise((resolve) => {
            const originalSend = res.send;
            res.send = function(data: any) {
              resolve(data);
              originalSend.call(res, data);
            };
            next();
          });
        },
        { ttl }
      );

      if (cached) {
        res.set('X-Cache', 'HIT');
        res.send(cached);
      }
    } catch (error) {
      next();
    }
  };
}