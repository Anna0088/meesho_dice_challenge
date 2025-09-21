import { getDatabase } from '../config/database';
import { logger } from '../utils/logger';
import { getRedisClient } from '../config/redis';
import { publishEvent } from '../utils/eventPublisher';
import { SellerQualityScore } from '../models/seller.model';

const db = getDatabase;
const redis = getRedisClient;

interface MetricData {
  sellerId: string;
  metricName: string;
  value: number;
  timestamp: Date;
}

interface SQSMetrics {
  // Catalog Excellence (35%)
  imageQualityScore: number;
  descriptionCompleteness: number;
  attributeFillRate: number;
  duplicateListingScore: number;

  // Operational Efficiency (40%)
  orderFulfillmentRate: number;
  onTimeShippingRate: number;
  sellerCancellationRate: number;
  sellerResponseTime: number;

  // Customer Satisfaction (25%)
  averageProductRating: number;
  orderDefectRate: number;
  returnRate: number;
}

export class SQSCalculationService {
  private readonly weights = {
    catalog: {
      total: 0.35,
      metrics: {
        imageQuality: 0.10,
        description: 0.10,
        attributes: 0.10,
        duplicates: 0.05,
      },
    },
    operations: {
      total: 0.40,
      metrics: {
        fulfillment: 0.10,
        shipping: 0.15,
        cancellation: 0.10,
        responseTime: 0.05,
      },
    },
    satisfaction: {
      total: 0.25,
      metrics: {
        rating: 0.10,
        defects: 0.10,
        returns: 0.05,
      },
    },
  };

  async calculateSQSForSeller(sellerId: string): Promise<SellerQualityScore> {
    try {
      logger.info(`Calculating SQS for seller: ${sellerId}`);

      // Fetch metrics from various sources
      const metrics = await this.fetchSellerMetrics(sellerId);

      // Calculate individual pillar scores
      const catalogScore = this.calculateCatalogScore(metrics);
      const operationsScore = this.calculateOperationsScore(metrics);
      const satisfactionScore = this.calculateSatisfactionScore(metrics);

      // Calculate overall score (0-1000 scale)
      const overallScore = Math.round(
        (catalogScore * this.weights.catalog.total +
          operationsScore * this.weights.operations.total +
          satisfactionScore * this.weights.satisfaction.total) * 10
      );

      // Prepare SQS record
      const sqs: SellerQualityScore = {
        seller_id: sellerId,
        overall_score: overallScore,
        catalog_score: Math.round(catalogScore),
        operations_score: Math.round(operationsScore),
        satisfaction_score: Math.round(satisfactionScore),
        calculated_at: new Date(),
        metrics: {
          image_quality_score: metrics.imageQualityScore,
          description_completeness: metrics.descriptionCompleteness,
          attribute_fill_rate: metrics.attributeFillRate,
          duplicate_listing_score: metrics.duplicateListingScore,
          order_fulfillment_rate: metrics.orderFulfillmentRate,
          on_time_shipping_rate: metrics.onTimeShippingRate,
          seller_cancellation_rate: metrics.sellerCancellationRate,
          seller_response_time: metrics.sellerResponseTime,
          average_product_rating: metrics.averageProductRating,
          order_defect_rate: metrics.orderDefectRate,
          return_rate: metrics.returnRate,
        },
      };

      // Save to database
      await this.saveSQS(sqs);

      // Cache in Redis for quick access
      await this.cacheSQS(sellerId, sqs);

      // Update seller profile with latest SQS
      await db()('seller_profiles')
        .where('seller_id', sellerId)
        .update({
          sqs_score: overallScore,
          updated_at: new Date(),
        });

      // Publish SQS updated event
      await publishEvent('sqs.updated', {
        sellerId,
        oldScore: await this.getPreviousSQS(sellerId),
        newScore: overallScore,
        timestamp: new Date().toISOString(),
      });

      logger.info(`SQS calculated for seller ${sellerId}: ${overallScore}`);
      return sqs;
    } catch (error) {
      logger.error(`Failed to calculate SQS for seller ${sellerId}:`, error);
      throw new Error('SQS calculation failed');
    }
  }

  private async fetchSellerMetrics(sellerId: string): Promise<SQSMetrics> {
    try {
      // Fetch from different data sources (simulated here)
      const catalogMetrics = await this.fetchCatalogMetrics(sellerId);
      const operationalMetrics = await this.fetchOperationalMetrics(sellerId);
      const satisfactionMetrics = await this.fetchSatisfactionMetrics(sellerId);

      return {
        ...catalogMetrics,
        ...operationalMetrics,
        ...satisfactionMetrics,
      };
    } catch (error) {
      logger.error(`Failed to fetch metrics for seller ${sellerId}:`, error);
      throw error;
    }
  }

  private async fetchCatalogMetrics(sellerId: string): Promise<Partial<SQSMetrics>> {
    // Simulate fetching catalog metrics from catalog service
    // In production, this would make API calls or query the catalog database

    const imageQuality = await this.getMetricValue(sellerId, 'image_quality', 85);
    const description = await this.getMetricValue(sellerId, 'description_quality', 78);
    const attributes = await this.getMetricValue(sellerId, 'attribute_fill', 92);
    const duplicates = await this.getMetricValue(sellerId, 'duplicate_score', 95);

    return {
      imageQualityScore: imageQuality,
      descriptionCompleteness: description,
      attributeFillRate: attributes,
      duplicateListingScore: duplicates,
    };
  }

  private async fetchOperationalMetrics(sellerId: string): Promise<Partial<SQSMetrics>> {
    // Simulate fetching operational metrics from order service
    const fulfillment = await this.getMetricValue(sellerId, 'fulfillment_rate', 96);
    const shipping = await this.getMetricValue(sellerId, 'on_time_shipping', 88);
    const cancellation = await this.getMetricValue(sellerId, 'cancellation_rate', 3);
    const responseTime = await this.getMetricValue(sellerId, 'response_time', 2.5);

    return {
      orderFulfillmentRate: fulfillment,
      onTimeShippingRate: shipping,
      sellerCancellationRate: cancellation,
      sellerResponseTime: responseTime,
    };
  }

  private async fetchSatisfactionMetrics(sellerId: string): Promise<Partial<SQSMetrics>> {
    // Simulate fetching satisfaction metrics from review and returns services
    const rating = await this.getMetricValue(sellerId, 'avg_rating', 4.2);
    const defects = await this.getMetricValue(sellerId, 'defect_rate', 2.1);
    const returns = await this.getMetricValue(sellerId, 'return_rate', 4.5);

    return {
      averageProductRating: rating * 20, // Convert 5-star to 100-point scale
      orderDefectRate: defects,
      returnRate: returns,
    };
  }

  private calculateCatalogScore(metrics: SQSMetrics): number {
    const weights = this.weights.catalog.metrics;

    const score =
      metrics.imageQualityScore * (weights.imageQuality / this.weights.catalog.total) +
      metrics.descriptionCompleteness * (weights.description / this.weights.catalog.total) +
      metrics.attributeFillRate * (weights.attributes / this.weights.catalog.total) +
      metrics.duplicateListingScore * (weights.duplicates / this.weights.catalog.total);

    return Math.min(100, Math.max(0, score));
  }

  private calculateOperationsScore(metrics: SQSMetrics): number {
    const weights = this.weights.operations.metrics;

    // Invert cancellation rate (lower is better)
    const adjustedCancellationScore = 100 - metrics.sellerCancellationRate;

    // Normalize response time (faster is better, assuming max 24 hours)
    const adjustedResponseScore = Math.max(0, 100 - (metrics.sellerResponseTime / 24) * 100);

    const score =
      metrics.orderFulfillmentRate * (weights.fulfillment / this.weights.operations.total) +
      metrics.onTimeShippingRate * (weights.shipping / this.weights.operations.total) +
      adjustedCancellationScore * (weights.cancellation / this.weights.operations.total) +
      adjustedResponseScore * (weights.responseTime / this.weights.operations.total);

    return Math.min(100, Math.max(0, score));
  }

  private calculateSatisfactionScore(metrics: SQSMetrics): number {
    const weights = this.weights.satisfaction.metrics;

    // Invert defect and return rates (lower is better)
    const adjustedDefectScore = Math.max(0, 100 - metrics.orderDefectRate * 10);
    const adjustedReturnScore = Math.max(0, 100 - metrics.returnRate * 5);

    const score =
      metrics.averageProductRating * (weights.rating / this.weights.satisfaction.total) +
      adjustedDefectScore * (weights.defects / this.weights.satisfaction.total) +
      adjustedReturnScore * (weights.returns / this.weights.satisfaction.total);

    return Math.min(100, Math.max(0, score));
  }

  private async saveSQS(sqs: SellerQualityScore): Promise<void> {
    try {
      await db()('seller_quality_scores').insert({
        score_id: require('uuid').v4(),
        seller_id: sqs.seller_id,
        overall_score: sqs.overall_score,
        catalog_score: sqs.catalog_score,
        operations_score: sqs.operations_score,
        satisfaction_score: sqs.satisfaction_score,
        metrics: JSON.stringify(sqs.metrics),
        calculated_at: sqs.calculated_at,
      });
    } catch (error) {
      logger.error('Failed to save SQS to database:', error);
      throw error;
    }
  }

  private async cacheSQS(sellerId: string, sqs: SellerQualityScore): Promise<void> {
    try {
      const cacheKey = `sqs:${sellerId}`;
      const ttl = 3600; // 1 hour

      await redis().setex(cacheKey, ttl, JSON.stringify(sqs));
    } catch (error) {
      logger.error('Failed to cache SQS:', error);
      // Non-critical error, don't throw
    }
  }

  private async getPreviousSQS(sellerId: string): Promise<number | null> {
    try {
      const previousScore = await db()('seller_quality_scores')
        .where('seller_id', sellerId)
        .orderBy('calculated_at', 'desc')
        .offset(1)
        .limit(1)
        .select('overall_score')
        .first();

      return previousScore?.overall_score || null;
    } catch (error) {
      logger.error('Failed to fetch previous SQS:', error);
      return null;
    }
  }

  private async getMetricValue(
    sellerId: string,
    metricName: string,
    defaultValue: number
  ): Promise<number> {
    // In production, this would fetch actual metric values from various services
    // For now, returning simulated values
    const variance = (Math.random() - 0.5) * 20; // ±10% variance
    return Math.max(0, Math.min(100, defaultValue + variance));
  }

  async getSQSHistory(
    sellerId: string,
    days: number = 30
  ): Promise<SellerQualityScore[]> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const history = await db()('seller_quality_scores')
        .where('seller_id', sellerId)
        .where('calculated_at', '>=', startDate)
        .orderBy('calculated_at', 'desc');

      return history.map(record => ({
        ...record,
        metrics: JSON.parse(record.metrics),
      }));
    } catch (error) {
      logger.error(`Failed to fetch SQS history for seller ${sellerId}:`, error);
      throw new Error('Failed to fetch SQS history');
    }
  }

  async getTopPerformers(limit: number = 10): Promise<any[]> {
    try {
      const topSellers = await db()('seller_profiles')
        .where('verification_status', 'approved')
        .whereNotNull('sqs_score')
        .orderBy('sqs_score', 'desc')
        .limit(limit)
        .select('seller_id', 'business_name', 'sqs_score', 'tier');

      return topSellers;
    } catch (error) {
      logger.error('Failed to fetch top performers:', error);
      throw new Error('Failed to fetch top performers');
    }
  }

  async calculateBulkSQS(): Promise<void> {
    try {
      logger.info('Starting bulk SQS calculation');

      // Get all approved sellers
      const sellers = await db()('seller_profiles')
        .where('verification_status', 'approved')
        .select('seller_id');

      // Calculate SQS for each seller in batches
      const batchSize = 10;
      for (let i = 0; i < sellers.length; i += batchSize) {
        const batch = sellers.slice(i, i + batchSize);
        await Promise.all(
          batch.map(seller => this.calculateSQSForSeller(seller.seller_id))
        );

        logger.info(`Processed ${i + batch.length}/${sellers.length} sellers`);
      }

      logger.info('Bulk SQS calculation completed');
    } catch (error) {
      logger.error('Bulk SQS calculation failed:', error);
      throw error;
    }
  }
}

export const sqsCalculationService = new SQSCalculationService();