import { getDatabase } from '../config/database';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { sqsCalculationService } from './sqsCalculationService';
import { analyticsService } from './analyticsService';

const db = getDatabase;
const redis = getRedisClient;

interface Recommendation {
  id: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  actionItems: string[];
  expectedImpact: {
    metric: string;
    improvement: number;
    timeframe: string;
  };
  resources?: {
    type: string;
    url: string;
    title: string;
  }[];
}

interface MLPrediction {
  metric: string;
  predictedValue: number;
  confidence: number;
  trend: 'up' | 'down' | 'stable';
}

export class RecommendationEngine {
  private readonly thresholds = {
    sqs: {
      critical: 500,
      warning: 650,
      good: 750,
      excellent: 850,
    },
    fulfillment: {
      critical: 85,
      warning: 90,
      good: 95,
      excellent: 98,
    },
    shipping: {
      critical: 80,
      warning: 85,
      good: 90,
      excellent: 95,
    },
    rating: {
      critical: 3.0,
      warning: 3.5,
      good: 4.0,
      excellent: 4.5,
    },
  };

  async generateRecommendations(sellerId: string): Promise<Recommendation[]> {
    try {
      logger.info(`Generating recommendations for seller: ${sellerId}`);

      // Gather all necessary data
      const [sqsData, kpis, trends, predictions] = await Promise.all([
        sqsCalculationService.getSQSHistory(sellerId, 30),
        analyticsService.getDashboardKPIs(sellerId, '30d'),
        analyticsService.getPerformanceTrends(sellerId, '7d'),
        this.generatePredictions(sellerId),
      ]);

      const recommendations: Recommendation[] = [];

      // Analyze SQS components
      if (sqsData.length > 0) {
        const latestSQS = sqsData[0];
        recommendations.push(...this.analyzeSQSComponents(latestSQS));
      }

      // Analyze trends
      recommendations.push(...this.analyzeTrends(trends));

      // Analyze predictions
      recommendations.push(...this.analyzePredictions(predictions));

      // Generate strategic recommendations
      recommendations.push(...await this.generateStrategicRecommendations(sellerId, kpis));

      // Sort by priority and deduplicate
      return this.prioritizeAndDeduplicate(recommendations);
    } catch (error) {
      logger.error(`Failed to generate recommendations for seller ${sellerId}:`, error);
      throw new Error('Failed to generate recommendations');
    }
  }

  private analyzeSQSComponents(sqs: any): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Catalog Excellence Analysis
    if (sqs.catalog_score < this.thresholds.sqs.warning) {
      const catalogRec = this.createCatalogRecommendation(sqs);
      if (catalogRec) recommendations.push(catalogRec);
    }

    // Operational Efficiency Analysis
    if (sqs.operations_score < this.thresholds.sqs.warning) {
      const opsRec = this.createOperationalRecommendation(sqs);
      if (opsRec) recommendations.push(opsRec);
    }

    // Customer Satisfaction Analysis
    if (sqs.satisfaction_score < this.thresholds.sqs.warning) {
      const satRec = this.createSatisfactionRecommendation(sqs);
      if (satRec) recommendations.push(satRec);
    }

    return recommendations;
  }

  private createCatalogRecommendation(sqs: any): Recommendation {
    const metrics = sqs.metrics;
    const weakestMetric = this.findWeakestMetric({
      'Image Quality': metrics.image_quality_score,
      'Description': metrics.description_completeness,
      'Attributes': metrics.attribute_fill_rate,
      'Duplicates': 100 - metrics.duplicate_listing_score,
    });

    return {
      id: `catalog_${Date.now()}`,
      priority: sqs.catalog_score < 50 ? 'urgent' : 'high',
      category: 'catalog',
      title: `Improve ${weakestMetric.name}`,
      description: `Your ${weakestMetric.name.toLowerCase()} score is ${weakestMetric.value.toFixed(0)}%, which is below the platform average`,
      actionItems: this.getCatalogActionItems(weakestMetric.name),
      expectedImpact: {
        metric: 'Catalog Score',
        improvement: 20,
        timeframe: '7 days',
      },
      resources: [
        {
          type: 'guide',
          url: '/guides/catalog-optimization',
          title: 'Catalog Optimization Best Practices',
        },
        {
          type: 'video',
          url: '/videos/product-photography',
          title: 'Product Photography Tutorial',
        },
      ],
    };
  }

  private createOperationalRecommendation(sqs: any): Recommendation {
    const metrics = sqs.metrics;
    const issues = [];

    if (metrics.order_fulfillment_rate < this.thresholds.fulfillment.good) {
      issues.push('fulfillment');
    }
    if (metrics.on_time_shipping_rate < this.thresholds.shipping.good) {
      issues.push('shipping');
    }
    if (metrics.seller_cancellation_rate > 5) {
      issues.push('cancellation');
    }

    const primaryIssue = issues[0] || 'operations';

    return {
      id: `ops_${Date.now()}`,
      priority: metrics.order_fulfillment_rate < this.thresholds.fulfillment.critical ? 'urgent' : 'high',
      category: 'operations',
      title: `Improve ${primaryIssue.charAt(0).toUpperCase() + primaryIssue.slice(1)} Performance`,
      description: `Your operational metrics are impacting customer experience`,
      actionItems: this.getOperationalActionItems(primaryIssue),
      expectedImpact: {
        metric: 'Operations Score',
        improvement: 15,
        timeframe: '14 days',
      },
      resources: [
        {
          type: 'guide',
          url: '/guides/fulfillment-best-practices',
          title: 'Fulfillment Best Practices',
        },
      ],
    };
  }

  private createSatisfactionRecommendation(sqs: any): Recommendation {
    const metrics = sqs.metrics;

    return {
      id: `satisfaction_${Date.now()}`,
      priority: metrics.average_product_rating < this.thresholds.rating.critical ? 'urgent' : 'medium',
      category: 'satisfaction',
      title: 'Enhance Customer Satisfaction',
      description: `Your average rating is ${(metrics.average_product_rating / 20).toFixed(1)}/5.0`,
      actionItems: [
        'Respond to all customer inquiries within 2 hours',
        'Address negative reviews with solutions',
        'Implement quality checks before shipping',
        'Provide detailed product information to set correct expectations',
      ],
      expectedImpact: {
        metric: 'Customer Satisfaction',
        improvement: 25,
        timeframe: '30 days',
      },
    };
  }

  private analyzeTrends(trends: any[]): Recommendation[] {
    const recommendations: Recommendation[] = [];

    if (trends.length < 2) return recommendations;

    // Detect declining trends
    const recentTrend = trends[trends.length - 1];
    const previousTrend = trends[trends.length - 2];

    // Revenue decline
    if (recentTrend.revenue < previousTrend.revenue * 0.8) {
      recommendations.push({
        id: `trend_revenue_${Date.now()}`,
        priority: 'high',
        category: 'trend',
        title: 'Revenue Decline Detected',
        description: 'Your revenue has dropped by more than 20% compared to yesterday',
        actionItems: [
          'Review pricing strategy',
          'Check for out-of-stock popular items',
          'Analyze competitor activities',
          'Run promotional campaigns',
        ],
        expectedImpact: {
          metric: 'Revenue',
          improvement: 30,
          timeframe: '3 days',
        },
      });
    }

    // Conversion rate decline
    if (recentTrend.conversion < previousTrend.conversion * 0.7) {
      recommendations.push({
        id: `trend_conversion_${Date.now()}`,
        priority: 'medium',
        category: 'trend',
        title: 'Conversion Rate Drop',
        description: 'Your conversion rate has declined significantly',
        actionItems: [
          'Review product descriptions and images',
          'Check pricing against competitors',
          'Ensure accurate stock levels',
          'Optimize product titles for search',
        ],
        expectedImpact: {
          metric: 'Conversion Rate',
          improvement: 1.5,
          timeframe: '7 days',
        },
      });
    }

    return recommendations;
  }

  private async generatePredictions(sellerId: string): Promise<MLPrediction[]> {
    // Simulate ML predictions
    // In production, this would use actual ML models
    const predictions: MLPrediction[] = [
      {
        metric: 'revenue_next_week',
        predictedValue: 75000 + Math.random() * 25000,
        confidence: 0.85,
        trend: 'up',
      },
      {
        metric: 'sqs_next_week',
        predictedValue: 750 + Math.random() * 100,
        confidence: 0.78,
        trend: 'stable',
      },
      {
        metric: 'return_rate_next_month',
        predictedValue: 3.5 + Math.random() * 2,
        confidence: 0.72,
        trend: 'down',
      },
    ];

    return predictions;
  }

  private analyzePredictions(predictions: MLPrediction[]): Recommendation[] {
    const recommendations: Recommendation[] = [];

    for (const prediction of predictions) {
      if (prediction.metric === 'return_rate_next_month' && prediction.predictedValue > 5) {
        recommendations.push({
          id: `predict_returns_${Date.now()}`,
          priority: 'medium',
          category: 'predictive',
          title: 'High Return Rate Predicted',
          description: `ML models predict your return rate may increase to ${prediction.predictedValue.toFixed(1)}%`,
          actionItems: [
            'Review product quality with suppliers',
            'Improve product descriptions accuracy',
            'Add size charts and detailed specifications',
            'Implement quality control checks',
          ],
          expectedImpact: {
            metric: 'Return Rate',
            improvement: -2,
            timeframe: '30 days',
          },
        });
      }

      if (prediction.metric === 'sqs_next_week' && prediction.predictedValue < 700) {
        recommendations.push({
          id: `predict_sqs_${Date.now()}`,
          priority: 'high',
          category: 'predictive',
          title: 'SQS Decline Predicted',
          description: 'Your quality score is predicted to drop below threshold',
          actionItems: [
            'Take immediate action on operational metrics',
            'Update stale product listings',
            'Respond to pending customer inquiries',
            'Review and address recent negative feedback',
          ],
          expectedImpact: {
            metric: 'SQS Score',
            improvement: 50,
            timeframe: '7 days',
          },
        });
      }
    }

    return recommendations;
  }

  private async generateStrategicRecommendations(
    sellerId: string,
    kpis: any
  ): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    // Growth opportunities
    if (kpis.activeListings < 50) {
      recommendations.push({
        id: `strategic_catalog_${Date.now()}`,
        priority: 'medium',
        category: 'strategic',
        title: 'Expand Your Product Catalog',
        description: 'You have fewer listings than successful sellers in your category',
        actionItems: [
          'Research trending products in your category',
          'Add complementary products to existing listings',
          'Explore new sub-categories',
          'Source products from verified suppliers',
        ],
        expectedImpact: {
          metric: 'Revenue',
          improvement: 40,
          timeframe: '60 days',
        },
      });
    }

    // Seasonal recommendations
    const seasonalRec = this.getSeasonalRecommendation();
    if (seasonalRec) {
      recommendations.push(seasonalRec);
    }

    // Cross-selling opportunities
    if (kpis.averageOrderValue < 500) {
      recommendations.push({
        id: `strategic_aov_${Date.now()}`,
        priority: 'low',
        category: 'strategic',
        title: 'Increase Average Order Value',
        description: 'Your AOV is below category average',
        actionItems: [
          'Create product bundles',
          'Offer volume discounts',
          'Implement minimum order incentives',
          'Add premium product variants',
        ],
        expectedImpact: {
          metric: 'AOV',
          improvement: 25,
          timeframe: '30 days',
        },
      });
    }

    return recommendations;
  }

  private findWeakestMetric(metrics: { [key: string]: number }): { name: string; value: number } {
    let weakest = { name: '', value: 100 };

    for (const [name, value] of Object.entries(metrics)) {
      if (value < weakest.value) {
        weakest = { name, value };
      }
    }

    return weakest;
  }

  private getCatalogActionItems(metricName: string): string[] {
    const actionMap: { [key: string]: string[] } = {
      'Image Quality': [
        'Use high-resolution images (minimum 1000x1000 pixels)',
        'Ensure proper lighting and white background',
        'Add multiple angles and lifestyle shots',
        'Include zoom-in details of key features',
      ],
      'Description': [
        'Write detailed product descriptions (minimum 150 words)',
        'Include key features and benefits',
        'Add usage instructions and care guidelines',
        'Use bullet points for better readability',
      ],
      'Attributes': [
        'Fill all mandatory product attributes',
        'Add size, color, and material information',
        'Include brand and model details',
        'Specify warranty and return policy',
      ],
      'Duplicates': [
        'Remove duplicate product listings',
        'Merge similar products into variants',
        'Use unique titles for each product',
        'Consolidate inventory across listings',
      ],
    };

    return actionMap[metricName] || ['Improve overall catalog quality'];
  }

  private getOperationalActionItems(issue: string): string[] {
    const actionMap: { [key: string]: string[] } = {
      fulfillment: [
        'Maintain adequate inventory levels',
        'Set realistic processing times',
        'Automate order confirmation process',
        'Partner with reliable logistics providers',
      ],
      shipping: [
        'Ship orders within 24 hours',
        'Use express shipping for delayed orders',
        'Update tracking information promptly',
        'Communicate delays proactively to customers',
      ],
      cancellation: [
        'Verify inventory before accepting orders',
        'Set accurate product availability',
        'Improve order processing workflow',
        'Contact customers before cancelling orders',
      ],
    };

    return actionMap[issue] || ['Improve operational efficiency'];
  }

  private getSeasonalRecommendation(): Recommendation | null {
    const month = new Date().getMonth();
    const seasonalEvents: { [key: number]: { event: string; actions: string[] } } = {
      0: { event: 'New Year Sales', actions: ['Stock fitness and organization products'] },
      9: { event: 'Diwali Preparation', actions: ['Stock festive decorations and gifts'] },
      11: { event: 'Year-End Clearance', actions: ['Offer discounts on slow-moving inventory'] },
    };

    const event = seasonalEvents[month];
    if (!event) return null;

    return {
      id: `seasonal_${Date.now()}`,
      priority: 'medium',
      category: 'seasonal',
      title: `Prepare for ${event.event}`,
      description: 'Seasonal opportunity to boost sales',
      actionItems: event.actions,
      expectedImpact: {
        metric: 'Revenue',
        improvement: 50,
        timeframe: '30 days',
      },
    };
  }

  private prioritizeAndDeduplicate(recommendations: Recommendation[]): Recommendation[] {
    // Remove duplicates based on category and title similarity
    const seen = new Set<string>();
    const unique = recommendations.filter(rec => {
      const key = `${rec.category}_${rec.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by priority
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    return unique.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }

  async saveRecommendation(sellerId: string, recommendation: Recommendation): Promise<void> {
    try {
      await db()('seller_recommendations').insert({
        recommendation_id: recommendation.id,
        seller_id: sellerId,
        priority: recommendation.priority,
        category: recommendation.category,
        title: recommendation.title,
        description: recommendation.description,
        action_items: JSON.stringify(recommendation.actionItems),
        expected_impact: JSON.stringify(recommendation.expectedImpact),
        resources: JSON.stringify(recommendation.resources || []),
        created_at: new Date(),
        is_read: false,
        is_actioned: false,
      });
    } catch (error) {
      logger.error('Failed to save recommendation:', error);
    }
  }

  async getRecommendationHistory(sellerId: string, limit: number = 50): Promise<any[]> {
    try {
      const history = await db()('seller_recommendations')
        .where('seller_id', sellerId)
        .orderBy('created_at', 'desc')
        .limit(limit);

      return history.map(rec => ({
        ...rec,
        action_items: JSON.parse(rec.action_items),
        expected_impact: JSON.parse(rec.expected_impact),
        resources: JSON.parse(rec.resources),
      }));
    } catch (error) {
      logger.error('Failed to fetch recommendation history:', error);
      return [];
    }
  }
}

export const recommendationEngine = new RecommendationEngine();