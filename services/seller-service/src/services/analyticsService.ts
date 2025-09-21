import { getDatabase } from '../config/database';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { sqsCalculationService } from './sqsCalculationService';

const db = getDatabase;
const redis = getRedisClient;

interface DashboardKPIs {
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  sqsScore: number;
  conversionRate: number;
  activeListings: number;
}

interface PerformanceTrend {
  date: string;
  revenue: number;
  orders: number;
  sqs: number;
  views: number;
  conversion: number;
}

interface TopProduct {
  productId: string;
  productName: string;
  revenue: number;
  unitsSold: number;
  averageRating: number;
}

interface CategoryPerformance {
  category: string;
  revenue: number;
  orders: number;
  returnRate: number;
  averageRating: number;
}

export class AnalyticsService {
  async getDashboardKPIs(sellerId: string, period: string = '30d'): Promise<DashboardKPIs> {
    try {
      const days = this.parsePeriod(period);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Fetch from cache first
      const cacheKey = `dashboard:kpis:${sellerId}:${period}`;
      const cached = await redis().get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Fetch metrics from various sources
      const [revenue, orders, sqs, listings] = await Promise.all([
        this.getRevenue(sellerId, startDate),
        this.getOrderCount(sellerId, startDate),
        this.getCurrentSQS(sellerId),
        this.getActiveListings(sellerId),
      ]);

      const kpis: DashboardKPIs = {
        totalRevenue: revenue,
        totalOrders: orders,
        averageOrderValue: orders > 0 ? revenue / orders : 0,
        sqsScore: sqs,
        conversionRate: await this.getConversionRate(sellerId, startDate),
        activeListings: listings,
      };

      // Cache for 1 hour
      await redis().setex(cacheKey, 3600, JSON.stringify(kpis));

      return kpis;
    } catch (error) {
      logger.error(`Failed to get dashboard KPIs for seller ${sellerId}:`, error);
      throw new Error('Failed to fetch dashboard KPIs');
    }
  }

  async getPerformanceTrends(
    sellerId: string,
    period: string = '30d'
  ): Promise<PerformanceTrend[]> {
    try {
      const days = this.parsePeriod(period);
      const trends: PerformanceTrend[] = [];

      // Generate dates for the period
      const dates = this.generateDateRange(days);

      // Fetch daily metrics
      for (const date of dates) {
        const dayMetrics = await this.getDayMetrics(sellerId, date);
        trends.push(dayMetrics);
      }

      return trends;
    } catch (error) {
      logger.error(`Failed to get performance trends for seller ${sellerId}:`, error);
      throw new Error('Failed to fetch performance trends');
    }
  }

  async getTopProducts(
    sellerId: string,
    limit: number = 10
  ): Promise<TopProduct[]> {
    try {
      // This would typically query the product/order database
      // For now, returning simulated data
      const products: TopProduct[] = [];

      for (let i = 1; i <= limit; i++) {
        products.push({
          productId: `prod_${i}`,
          productName: `Product ${i}`,
          revenue: Math.floor(Math.random() * 10000),
          unitsSold: Math.floor(Math.random() * 100),
          averageRating: 3.5 + Math.random() * 1.5,
        });
      }

      return products.sort((a, b) => b.revenue - a.revenue);
    } catch (error) {
      logger.error(`Failed to get top products for seller ${sellerId}:`, error);
      throw new Error('Failed to fetch top products');
    }
  }

  async getCategoryPerformance(sellerId: string): Promise<CategoryPerformance[]> {
    try {
      // This would typically aggregate data from product/order databases
      // For now, returning simulated data
      const categories = ['Electronics', 'Fashion', 'Home & Kitchen', 'Beauty', 'Sports'];

      return categories.map(category => ({
        category,
        revenue: Math.floor(Math.random() * 50000),
        orders: Math.floor(Math.random() * 500),
        returnRate: Math.random() * 10,
        averageRating: 3.5 + Math.random() * 1.5,
      }));
    } catch (error) {
      logger.error(`Failed to get category performance for seller ${sellerId}:`, error);
      throw new Error('Failed to fetch category performance');
    }
  }

  async getRecommendations(sellerId: string): Promise<any[]> {
    try {
      const recommendations = [];

      // Get current SQS and identify weak areas
      const sqsHistory = await sqsCalculationService.getSQSHistory(sellerId, 7);
      if (sqsHistory.length > 0) {
        const latestSQS = sqsHistory[0];

        // Check catalog score
        if (latestSQS.catalog_score < 70) {
          recommendations.push({
            priority: 'high',
            category: 'catalog',
            title: 'Improve Product Listings',
            message: 'Your catalog quality score is below average',
            action: 'Add high-quality images and detailed descriptions to your products',
            impact: 'Can improve your SQS by up to 50 points',
            metrics: {
              currentScore: latestSQS.catalog_score,
              targetScore: 85,
              affectedProducts: await this.getProductsNeedingImprovement(sellerId),
            },
          });
        }

        // Check operational efficiency
        if (latestSQS.operations_score < 75) {
          recommendations.push({
            priority: 'high',
            category: 'operations',
            title: 'Enhance Operational Efficiency',
            message: 'Your operational metrics need attention',
            action: 'Focus on faster shipping and reducing cancellations',
            impact: 'Can improve customer satisfaction by 30%',
            metrics: {
              currentScore: latestSQS.operations_score,
              targetScore: 90,
              shippingDelay: await this.getAverageShippingDelay(sellerId),
            },
          });
        }

        // Check customer satisfaction
        if (latestSQS.satisfaction_score < 80) {
          recommendations.push({
            priority: 'medium',
            category: 'satisfaction',
            title: 'Boost Customer Satisfaction',
            message: 'Customer feedback indicates room for improvement',
            action: 'Respond to customer inquiries faster and address negative reviews',
            impact: 'Can increase repeat purchases by 25%',
            metrics: {
              currentScore: latestSQS.satisfaction_score,
              targetScore: 90,
              negativeFeedback: await this.getNegativeFeedbackCount(sellerId),
            },
          });
        }

        // Trend-based recommendations
        if (sqsHistory.length > 1) {
          const trend = latestSQS.overall_score - sqsHistory[1].overall_score;
          if (trend < -10) {
            recommendations.push({
              priority: 'urgent',
              category: 'trend',
              title: 'Declining Performance Alert',
              message: 'Your SQS has dropped significantly in the last 24 hours',
              action: 'Review recent changes and address any operational issues immediately',
              impact: 'Prevent further decline in marketplace visibility',
              metrics: {
                decline: Math.abs(trend),
                previousScore: sqsHistory[1].overall_score,
                currentScore: latestSQS.overall_score,
              },
            });
          }
        }
      }

      // Add seasonal recommendations
      const seasonalRec = await this.getSeasonalRecommendations(sellerId);
      recommendations.push(...seasonalRec);

      return recommendations.sort((a, b) => {
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
    } catch (error) {
      logger.error(`Failed to get recommendations for seller ${sellerId}:`, error);
      throw new Error('Failed to fetch recommendations');
    }
  }

  async getCompetitorAnalysis(sellerId: string, category: string): Promise<any> {
    try {
      // Get seller's current metrics
      const sellerMetrics = await this.getDashboardKPIs(sellerId, '30d');

      // Get category averages (simulated)
      const categoryAverages = {
        averageSQS: 750,
        averageRevenue: 100000,
        averageOrders: 500,
        averageConversion: 2.5,
        averageRating: 4.0,
      };

      // Calculate percentile rankings
      const rankings = {
        sqsPercentile: this.calculatePercentile(sellerMetrics.sqsScore, categoryAverages.averageSQS),
        revenuePercentile: this.calculatePercentile(sellerMetrics.totalRevenue, categoryAverages.averageRevenue),
        ordersPercentile: this.calculatePercentile(sellerMetrics.totalOrders, categoryAverages.averageOrders),
        conversionPercentile: this.calculatePercentile(sellerMetrics.conversionRate, categoryAverages.averageConversion),
      };

      return {
        sellerMetrics,
        categoryAverages,
        rankings,
        topCompetitors: await this.getTopCompetitors(category),
        opportunities: this.identifyOpportunities(sellerMetrics, categoryAverages),
      };
    } catch (error) {
      logger.error(`Failed to get competitor analysis for seller ${sellerId}:`, error);
      throw new Error('Failed to fetch competitor analysis');
    }
  }

  // Helper methods
  private parsePeriod(period: string): number {
    const match = period.match(/(\d+)([dmy])/);
    if (!match) return 30;

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 'd':
        return value;
      case 'm':
        return value * 30;
      case 'y':
        return value * 365;
      default:
        return 30;
    }
  }

  private generateDateRange(days: number): Date[] {
    const dates: Date[] = [];
    const today = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dates.push(date);
    }

    return dates;
  }

  private async getRevenue(sellerId: string, startDate: Date): Promise<number> {
    // In production, this would query the order database
    // For now, returning simulated data
    const baseRevenue = 50000;
    const variance = Math.random() * 20000;
    return Math.floor(baseRevenue + variance);
  }

  private async getOrderCount(sellerId: string, startDate: Date): Promise<number> {
    // In production, this would query the order database
    const baseOrders = 250;
    const variance = Math.random() * 100;
    return Math.floor(baseOrders + variance);
  }

  private async getCurrentSQS(sellerId: string): Promise<number> {
    try {
      const seller = await db()('seller_profiles')
        .where('seller_id', sellerId)
        .select('sqs_score')
        .first();

      return seller?.sqs_score || 0;
    } catch (error) {
      logger.error(`Failed to get current SQS for seller ${sellerId}:`, error);
      return 0;
    }
  }

  private async getActiveListings(sellerId: string): Promise<number> {
    // In production, this would query the product database
    return Math.floor(50 + Math.random() * 200);
  }

  private async getConversionRate(sellerId: string, startDate: Date): Promise<number> {
    // In production, calculate from views and orders
    return parseFloat((1.5 + Math.random() * 3).toFixed(2));
  }

  private async getDayMetrics(sellerId: string, date: Date): Promise<PerformanceTrend> {
    // In production, aggregate daily metrics from various sources
    return {
      date: date.toISOString().split('T')[0],
      revenue: Math.floor(1000 + Math.random() * 5000),
      orders: Math.floor(5 + Math.random() * 25),
      sqs: Math.floor(700 + Math.random() * 200),
      views: Math.floor(100 + Math.random() * 500),
      conversion: parseFloat((1 + Math.random() * 4).toFixed(2)),
    };
  }

  private async getProductsNeedingImprovement(sellerId: string): Promise<number> {
    // Query products with low quality scores
    return Math.floor(5 + Math.random() * 20);
  }

  private async getAverageShippingDelay(sellerId: string): Promise<number> {
    // Calculate average shipping delay in hours
    return parseFloat((2 + Math.random() * 10).toFixed(1));
  }

  private async getNegativeFeedbackCount(sellerId: string): Promise<number> {
    // Count recent negative reviews and complaints
    return Math.floor(Math.random() * 10);
  }

  private async getSeasonalRecommendations(sellerId: string): Promise<any[]> {
    const recommendations = [];
    const currentMonth = new Date().getMonth();

    // Add seasonal recommendations based on month
    if (currentMonth >= 9 && currentMonth <= 11) {
      recommendations.push({
        priority: 'medium',
        category: 'seasonal',
        title: 'Prepare for Holiday Season',
        message: 'The festive season is approaching',
        action: 'Stock up on popular items and optimize your listings for gift searches',
        impact: 'Can increase sales by up to 150% during peak season',
        metrics: {
          daysUntilPeak: 30,
          recommendedStock: 500,
        },
      });
    }

    return recommendations;
  }

  private calculatePercentile(value: number, average: number): number {
    // Simplified percentile calculation
    const ratio = value / average;
    if (ratio >= 1.5) return 90;
    if (ratio >= 1.2) return 75;
    if (ratio >= 1.0) return 50;
    if (ratio >= 0.8) return 25;
    return 10;
  }

  private async getTopCompetitors(category: string): Promise<any[]> {
    // Return top performing sellers in the category
    return [
      { sellerId: 'comp1', name: 'Top Seller 1', sqs: 920 },
      { sellerId: 'comp2', name: 'Top Seller 2', sqs: 900 },
      { sellerId: 'comp3', name: 'Top Seller 3', sqs: 880 },
    ];
  }

  private identifyOpportunities(sellerMetrics: any, categoryAverages: any): string[] {
    const opportunities = [];

    if (sellerMetrics.sqsScore < categoryAverages.averageSQS) {
      opportunities.push('Improve quality score to match category leaders');
    }

    if (sellerMetrics.conversionRate < categoryAverages.averageConversion) {
      opportunities.push('Optimize product listings for better conversion');
    }

    if (sellerMetrics.totalRevenue < categoryAverages.averageRevenue) {
      opportunities.push('Expand product catalog or increase pricing strategically');
    }

    return opportunities;
  }
}

export const analyticsService = new AnalyticsService();