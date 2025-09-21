import { EventEmitter } from 'events';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { getEventBus } from '../integration/eventBus';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const redis = getRedisClient;

export interface SyncJob {
  id: string;
  source: string;
  destination: string;
  operation: 'create' | 'update' | 'delete' | 'sync';
  entity: string;
  entityId: string;
  data: any;
  priority: number;
  retryCount: number;
  maxRetries: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface SyncStrategy {
  name: string;
  source: DataSource;
  destination: DataSource;
  transform?: (data: any) => any;
  validate?: (data: any) => boolean;
  conflictResolution?: 'source-wins' | 'destination-wins' | 'merge' | 'manual';
  batchSize?: number;
  syncInterval?: number;
}

export interface DataSource {
  type: 'postgres' | 'redis' | 'api' | 'elasticsearch';
  connection: any;
  schema?: string;
  table?: string;
  index?: string;
}

export class DataSyncPipeline extends EventEmitter {
  private syncStrategies: Map<string, SyncStrategy> = new Map();
  private jobQueue: Map<string, SyncJob[]> = new Map();
  private processing: Set<string> = new Set();
  private syncIntervals: Map<string, NodeJS.Timeout> = new Map();
  private eventBus = getEventBus('sync-service');

  constructor() {
    super();
    this.initializeStrategies();
    this.startProcessing();
  }

  private initializeStrategies(): void {
    // Seller data sync strategy
    this.registerStrategy({
      name: 'seller-sync',
      source: {
        type: 'postgres',
        connection: new Pool({
          host: process.env.DB_HOST,
          database: 'seller_db',
        }),
        schema: 'public',
        table: 'sellers',
      },
      destination: {
        type: 'elasticsearch',
        connection: {
          node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
        },
        index: 'sellers',
      },
      transform: this.transformSellerData,
      syncInterval: 60000, // 1 minute
    });

    // Review data sync strategy
    this.registerStrategy({
      name: 'review-sync',
      source: {
        type: 'postgres',
        connection: new Pool({
          host: process.env.DB_HOST,
          database: 'review_db',
        }),
        schema: 'public',
        table: 'reviews',
      },
      destination: {
        type: 'redis',
        connection: redis(),
      },
      transform: this.transformReviewData,
      batchSize: 100,
      syncInterval: 30000, // 30 seconds
    });

    // Analytics aggregation sync
    this.registerStrategy({
      name: 'analytics-sync',
      source: {
        type: 'postgres',
        connection: new Pool({
          host: process.env.DB_HOST,
          database: 'analytics_db',
        }),
        schema: 'public',
        table: 'events',
      },
      destination: {
        type: 'postgres',
        connection: new Pool({
          host: process.env.DB_HOST,
          database: 'analytics_db',
        }),
        schema: 'aggregated',
        table: 'daily_metrics',
      },
      transform: this.aggregateAnalyticsData,
      syncInterval: 3600000, // 1 hour
    });
  }

  registerStrategy(strategy: SyncStrategy): void {
    this.syncStrategies.set(strategy.name, strategy);
    
    // Initialize job queue for this strategy
    if (!this.jobQueue.has(strategy.name)) {
      this.jobQueue.set(strategy.name, []);
    }

    // Start periodic sync if interval is specified
    if (strategy.syncInterval) {
      this.startPeriodicSync(strategy);
    }

    logger.info(`Sync strategy registered: ${strategy.name}`);
  }

  private startPeriodicSync(strategy: SyncStrategy): void {
    if (this.syncIntervals.has(strategy.name)) {
      clearInterval(this.syncIntervals.get(strategy.name)!);
    }

    const interval = setInterval(async () => {
      try {
        await this.performFullSync(strategy.name);
      } catch (error) {
        logger.error(`Periodic sync failed for ${strategy.name}:`, error);
      }
    }, strategy.syncInterval!);

    this.syncIntervals.set(strategy.name, interval);
  }

  async performFullSync(strategyName: string): Promise<void> {
    const strategy = this.syncStrategies.get(strategyName);
    if (!strategy) {
      throw new Error(`Strategy ${strategyName} not found`);
    }

    logger.info(`Starting full sync for ${strategyName}`);
    const startTime = Date.now();

    try {
      // Get all data from source
      const sourceData = await this.fetchFromSource(strategy.source);
      
      // Process in batches
      const batchSize = strategy.batchSize || 100;
      let processed = 0;
      let failed = 0;

      for (let i = 0; i < sourceData.length; i += batchSize) {
        const batch = sourceData.slice(i, i + batchSize);
        
        try {
          await this.processBatch(batch, strategy);
          processed += batch.length;
        } catch (error) {
          failed += batch.length;
          logger.error(`Batch sync failed:`, error);
        }

        // Emit progress
        this.emit('sync:progress', {
          strategy: strategyName,
          total: sourceData.length,
          processed,
          failed,
        });
      }

      const duration = Date.now() - startTime;
      logger.info(`Full sync completed for ${strategyName}`, {
        duration,
        processed,
        failed,
      });

      // Store sync metadata
      await this.storeSyncMetadata(strategyName, {
        lastSync: new Date(),
        recordsProcessed: processed,
        recordsFailed: failed,
        duration,
      });
    } catch (error) {
      logger.error(`Full sync failed for ${strategyName}:`, error);
      throw error;
    }
  }

  async syncEntity(
    strategyName: string,
    entityId: string,
    operation: 'create' | 'update' | 'delete'
  ): Promise<void> {
    const strategy = this.syncStrategies.get(strategyName);
    if (!strategy) {
      throw new Error(`Strategy ${strategyName} not found`);
    }

    const job: SyncJob = {
      id: uuidv4(),
      source: strategy.source.type,
      destination: strategy.destination.type,
      operation,
      entity: strategyName,
      entityId,
      data: null,
      priority: 1,
      retryCount: 0,
      maxRetries: 3,
      status: 'pending',
      createdAt: new Date(),
    };

    // Add to queue
    await this.enqueueJob(strategyName, job);
  }

  private async enqueueJob(strategyName: string, job: SyncJob): Promise<void> {
    const queue = this.jobQueue.get(strategyName) || [];
    
    // Add job to queue sorted by priority
    queue.push(job);
    queue.sort((a, b) => b.priority - a.priority);
    
    this.jobQueue.set(strategyName, queue);

    // Store in Redis for persistence
    await redis().zadd(
      `sync:queue:${strategyName}`,
      job.priority,
      JSON.stringify(job)
    );

    // Emit event
    this.emit('job:enqueued', job);
  }

  private startProcessing(): void {
    setInterval(async () => {
      for (const [strategyName, queue] of this.jobQueue) {
        if (queue.length > 0 && !this.processing.has(strategyName)) {
          await this.processQueue(strategyName);
        }
      }
    }, 1000); // Process every second
  }

  private async processQueue(strategyName: string): Promise<void> {
    if (this.processing.has(strategyName)) {
      return;
    }

    this.processing.add(strategyName);

    try {
      const queue = this.jobQueue.get(strategyName) || [];
      const strategy = this.syncStrategies.get(strategyName);
      
      if (!strategy || queue.length === 0) {
        return;
      }

      // Process jobs in batches
      const batchSize = 10;
      const batch = queue.splice(0, batchSize);

      await Promise.all(
        batch.map(job => this.processJob(job, strategy))
      );

      // Update queue
      this.jobQueue.set(strategyName, queue);
    } finally {
      this.processing.delete(strategyName);
    }
  }

  private async processJob(job: SyncJob, strategy: SyncStrategy): Promise<void> {
    job.status = 'processing';
    job.processedAt = new Date();

    try {
      // Fetch data if needed
      if (job.operation !== 'delete') {
        job.data = await this.fetchEntity(strategy.source, job.entityId);
        
        // Validate data
        if (strategy.validate && !strategy.validate(job.data)) {
          throw new Error('Data validation failed');
        }

        // Transform data
        if (strategy.transform) {
          job.data = strategy.transform(job.data);
        }
      }

      // Execute sync operation
      await this.executeSyncOperation(job, strategy);

      job.status = 'completed';
      job.completedAt = new Date();

      // Emit success event
      this.emit('job:completed', job);
      
      // Publish to event bus
      await this.eventBus.publish(`sync.${job.entity}.${job.operation}`, {
        entityId: job.entityId,
        data: job.data,
      });
    } catch (error: any) {
      job.error = error.message;
      job.retryCount++;

      if (job.retryCount < job.maxRetries) {
        // Re-enqueue for retry with exponential backoff
        setTimeout(() => {
          job.status = 'pending';
          this.enqueueJob(strategy.name, job);
        }, Math.pow(2, job.retryCount) * 1000);
      } else {
        job.status = 'failed';
        
        // Store in dead letter queue
        await this.storeFailedJob(job);
        
        // Emit failure event
        this.emit('job:failed', job);
      }

      logger.error(`Sync job failed:`, {
        job,
        error: error.message,
      });
    }
  }

  private async executeSyncOperation(
    job: SyncJob,
    strategy: SyncStrategy
  ): Promise<void> {
    const { destination } = strategy;

    switch (job.operation) {
      case 'create':
        await this.insertToDestination(destination, job.data);
        break;
      
      case 'update':
        await this.updateInDestination(destination, job.entityId, job.data);
        break;
      
      case 'delete':
        await this.deleteFromDestination(destination, job.entityId);
        break;
      
      case 'sync':
        // Check for conflicts
        const existing = await this.fetchEntity(destination, job.entityId);
        
        if (existing) {
          const resolved = await this.resolveConflict(
            job.data,
            existing,
            strategy.conflictResolution
          );
          await this.updateInDestination(destination, job.entityId, resolved);
        } else {
          await this.insertToDestination(destination, job.data);
        }
        break;
    }
  }

  private async resolveConflict(
    source: any,
    destination: any,
    resolution?: string
  ): Promise<any> {
    switch (resolution) {
      case 'source-wins':
        return source;
      
      case 'destination-wins':
        return destination;
      
      case 'merge':
        // Deep merge objects
        return this.deepMerge(destination, source);
      
      case 'manual':
        // Store conflict for manual resolution
        await this.storeConflict(source, destination);
        throw new Error('Manual conflict resolution required');
      
      default:
        // Default to source wins
        return source;
    }
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (source[key] instanceof Object && key in target) {
        result[key] = this.deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  // Data source operations
  private async fetchFromSource(source: DataSource): Promise<any[]> {
    switch (source.type) {
      case 'postgres':
        const query = `SELECT * FROM ${source.schema}.${source.table}`;
        const result = await source.connection.query(query);
        return result.rows;
      
      case 'redis':
        const keys = await source.connection.keys('*');
        const values = await Promise.all(
          keys.map(key => source.connection.get(key))
        );
        return values.map(v => JSON.parse(v));
      
      case 'elasticsearch':
        const response = await source.connection.search({
          index: source.index,
          size: 10000,
        });
        return response.body.hits.hits.map((hit: any) => hit._source);
      
      default:
        throw new Error(`Unsupported source type: ${source.type}`);
    }
  }

  private async fetchEntity(source: DataSource, entityId: string): Promise<any> {
    switch (source.type) {
      case 'postgres':
        const query = `SELECT * FROM ${source.schema}.${source.table} WHERE id = $1`;
        const result = await source.connection.query(query, [entityId]);
        return result.rows[0];
      
      case 'redis':
        const value = await source.connection.get(entityId);
        return value ? JSON.parse(value) : null;
      
      case 'elasticsearch':
        const response = await source.connection.get({
          index: source.index,
          id: entityId,
        });
        return response.body._source;
      
      default:
        throw new Error(`Unsupported source type: ${source.type}`);
    }
  }

  private async insertToDestination(destination: DataSource, data: any): Promise<void> {
    switch (destination.type) {
      case 'postgres':
        const columns = Object.keys(data).join(', ');
        const values = Object.values(data);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        const query = `INSERT INTO ${destination.schema}.${destination.table} (${columns}) VALUES (${placeholders})`;
        await destination.connection.query(query, values);
        break;
      
      case 'redis':
        await destination.connection.set(data.id, JSON.stringify(data));
        break;
      
      case 'elasticsearch':
        await destination.connection.index({
          index: destination.index,
          id: data.id,
          body: data,
        });
        break;
      
      default:
        throw new Error(`Unsupported destination type: ${destination.type}`);
    }
  }

  private async updateInDestination(
    destination: DataSource,
    entityId: string,
    data: any
  ): Promise<void> {
    switch (destination.type) {
      case 'postgres':
        const updates = Object.keys(data)
          .map((key, i) => `${key} = $${i + 2}`)
          .join(', ');
        const values = Object.values(data);
        const query = `UPDATE ${destination.schema}.${destination.table} SET ${updates} WHERE id = $1`;
        await destination.connection.query(query, [entityId, ...values]);
        break;
      
      case 'redis':
        await destination.connection.set(entityId, JSON.stringify(data));
        break;
      
      case 'elasticsearch':
        await destination.connection.update({
          index: destination.index,
          id: entityId,
          body: {
            doc: data,
          },
        });
        break;
      
      default:
        throw new Error(`Unsupported destination type: ${destination.type}`);
    }
  }

  private async deleteFromDestination(
    destination: DataSource,
    entityId: string
  ): Promise<void> {
    switch (destination.type) {
      case 'postgres':
        const query = `DELETE FROM ${destination.schema}.${destination.table} WHERE id = $1`;
        await destination.connection.query(query, [entityId]);
        break;
      
      case 'redis':
        await destination.connection.del(entityId);
        break;
      
      case 'elasticsearch':
        await destination.connection.delete({
          index: destination.index,
          id: entityId,
        });
        break;
      
      default:
        throw new Error(`Unsupported destination type: ${destination.type}`);
    }
  }

  private async processBatch(batch: any[], strategy: SyncStrategy): Promise<void> {
    const promises = batch.map(async (item) => {
      let data = item;
      
      // Transform if needed
      if (strategy.transform) {
        data = strategy.transform(item);
      }

      // Validate if needed
      if (strategy.validate && !strategy.validate(data)) {
        logger.warn(`Validation failed for item:`, data);
        return;
      }

      // Insert or update in destination
      try {
        await this.insertToDestination(strategy.destination, data);
      } catch (error) {
        // Try update if insert fails
        await this.updateInDestination(strategy.destination, data.id, data);
      }
    });

    await Promise.all(promises);
  }

  // Transform functions
  private transformSellerData(seller: any): any {
    return {
      id: seller.id,
      name: seller.name,
      email: seller.email,
      status: seller.status,
      tier: seller.tier,
      sqs: seller.sqs_score,
      created_at: seller.created_at,
      search_keywords: [
        seller.name,
        seller.email,
        seller.business_name,
      ].filter(Boolean),
    };
  }

  private transformReviewData(review: any): any {
    return {
      id: review.id,
      product_id: review.product_id,
      user_id: review.user_id,
      seller_id: review.seller_id,
      rating: review.rating,
      text: review.review_text,
      verified: review.verified_purchase,
      helpful_count: review.helpful_count,
      timestamp: review.created_at,
    };
  }

  private aggregateAnalyticsData(events: any[]): any {
    const aggregated: any = {};

    for (const event of events) {
      const date = new Date(event.timestamp).toISOString().split('T')[0];
      
      if (!aggregated[date]) {
        aggregated[date] = {
          date,
          total_events: 0,
          unique_users: new Set(),
          events_by_type: {},
        };
      }

      aggregated[date].total_events++;
      aggregated[date].unique_users.add(event.user_id);
      
      if (!aggregated[date].events_by_type[event.type]) {
        aggregated[date].events_by_type[event.type] = 0;
      }
      aggregated[date].events_by_type[event.type]++;
    }

    // Convert sets to counts
    return Object.values(aggregated).map((day: any) => ({
      ...day,
      unique_users: day.unique_users.size,
    }));
  }

  // Metadata storage
  private async storeSyncMetadata(strategyName: string, metadata: any): Promise<void> {
    const key = `sync:metadata:${strategyName}`;
    await redis().hset(key, {
      ...metadata,
      lastSync: metadata.lastSync.toISOString(),
    });
  }

  async getSyncMetadata(strategyName: string): Promise<any> {
    const key = `sync:metadata:${strategyName}`;
    return redis().hgetall(key);
  }

  private async storeFailedJob(job: SyncJob): Promise<void> {
    const key = `sync:failed:${job.entity}`;
    await redis().zadd(key, Date.now(), JSON.stringify(job));
    await redis().expire(key, 604800); // 7 days
  }

  private async storeConflict(source: any, destination: any): Promise<void> {
    const conflict = {
      id: uuidv4(),
      source,
      destination,
      timestamp: new Date(),
    };

    const key = 'sync:conflicts';
    await redis().zadd(key, Date.now(), JSON.stringify(conflict));
  }

  async getConflicts(limit: number = 100): Promise<any[]> {
    const key = 'sync:conflicts';
    const conflicts = await redis().zrevrange(key, 0, limit - 1);
    return conflicts.map(c => JSON.parse(c));
  }

  // Monitoring
  async getQueueStatus(): Promise<any> {
    const status: any = {};

    for (const [strategyName, queue] of this.jobQueue) {
      status[strategyName] = {
        pending: queue.filter(j => j.status === 'pending').length,
        processing: queue.filter(j => j.status === 'processing').length,
        completed: queue.filter(j => j.status === 'completed').length,
        failed: queue.filter(j => j.status === 'failed').length,
        total: queue.length,
      };
    }

    return status;
  }

  // Cleanup
  destroy(): void {
    for (const interval of this.syncIntervals.values()) {
      clearInterval(interval);
    }
    this.syncIntervals.clear();
    this.removeAllListeners();
  }
}

// Singleton instance
let dataSyncPipeline: DataSyncPipeline | null = null;

export function getDataSyncPipeline(): DataSyncPipeline {
  if (!dataSyncPipeline) {
    dataSyncPipeline = new DataSyncPipeline();
  }
  return dataSyncPipeline;
}