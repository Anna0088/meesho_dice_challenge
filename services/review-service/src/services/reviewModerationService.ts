import { getDatabase } from '../config/database';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { getMLModelService } from './mlModelService';
import { behavioralAnomalyService } from './behavioralAnomalyService';
import { publishEvent } from '../utils/eventPublisher';
import { v4 as uuidv4 } from 'uuid';

const db = getDatabase;
const redis = getRedisClient;

interface Review {
  reviewId: string;
  productId: string;
  userId: string;
  sellerId: string;
  rating: number;
  reviewText: string;
  photoUrls?: string[];
  videoUrl?: string;
  isVerifiedPurchase: boolean;
  isIncentivized: boolean;
  metadata: {
    ipAddress: string;
    deviceFingerprint: string;
    userAgent: string;
    accountAge: number;
  };
}

interface ModerationResult {
  decision: 'approved' | 'rejected' | 'requires_human_review';
  genuinenessScore: number;
  behavioralRiskScore: number;
  mlAnomalies: string[];
  behavioralFlags: any;
  reason?: string;
  confidence: number;
}

export class ReviewModerationService {
  private readonly thresholds = {
    genuineness: {
      autoApprove: 0.8,
      autoReject: 0.3,
    },
    behavioral: {
      autoReject: 0.7,
      review: 0.5,
    },
    combined: {
      autoApprove: 0.75,
      autoReject: 0.35,
    },
  };

  async moderateReview(review: Review): Promise<ModerationResult> {
    try {
      logger.info(`Moderating review ${review.reviewId}`);

      // Run parallel analysis
      const [
        genuinenessScore,
        mlAnomalies,
        behavioralFlags,
      ] = await Promise.all([
        this.analyzeGenuineness(review),
        this.detectMLAnomalies(review.reviewText),
        this.analyzeBehavior(review),
      ]);

      // Calculate behavioral risk score
      const behavioralRiskScore = await behavioralAnomalyService.calculateRiskScore(behavioralFlags);

      // Combine scores for final decision
      const combinedScore = this.calculateCombinedScore(
        genuinenessScore,
        behavioralRiskScore
      );

      // Make moderation decision
      const decision = this.makeDecision(
        combinedScore,
        genuinenessScore,
        behavioralRiskScore,
        mlAnomalies,
        behavioralFlags
      );

      // Store moderation result
      await this.storeModerationResult(review.reviewId, {
        ...decision,
        genuinenessScore,
        behavioralRiskScore,
        mlAnomalies,
        behavioralFlags,
      });

      // Handle decision
      await this.handleDecision(review, decision);

      return {
        ...decision,
        genuinenessScore,
        behavioralRiskScore,
        mlAnomalies,
        behavioralFlags,
      };
    } catch (error) {
      logger.error(`Failed to moderate review ${review.reviewId}:`, error);
      throw error;
    }
  }

  private async analyzeGenuineness(review: Review): Promise<number> {
    const mlService = getMLModelService();

    // Prepare metadata for ML model
    const metadata = {
      isVerifiedPurchase: review.isVerifiedPurchase,
      accountAge: review.metadata.accountAge,
      reviewCount: await this.getUserReviewCount(review.userId),
      ratingVariance: await this.getUserRatingVariance(review.userId),
    };

    return mlService.predictGenuineness(review.reviewText, metadata);
  }

  private async detectMLAnomalies(reviewText: string): Promise<string[]> {
    const mlService = getMLModelService();
    return mlService.detectAnomalies(reviewText);
  }

  private async analyzeBehavior(review: Review): Promise<any> {
    return behavioralAnomalyService.detectAnomalies({
      userId: review.userId,
      productId: review.productId,
      sellerId: review.sellerId,
      ipAddress: review.metadata.ipAddress,
      deviceFingerprint: review.metadata.deviceFingerprint,
      userAgent: review.metadata.userAgent,
      timestamp: new Date(),
      rating: review.rating,
      isVerifiedPurchase: review.isVerifiedPurchase,
      accountAge: review.metadata.accountAge,
    });
  }

  private calculateCombinedScore(genuinenessScore: number, behavioralRiskScore: number): number {
    // Weight genuineness more heavily than behavioral risk
    const genuinenessWeight = 0.6;
    const behavioralWeight = 0.4;

    // Invert behavioral risk score (lower risk is better)
    const behavioralScore = 1 - behavioralRiskScore;

    return genuinenessScore * genuinenessWeight + behavioralScore * behavioralWeight;
  }

  private makeDecision(
    combinedScore: number,
    genuinenessScore: number,
    behavioralRiskScore: number,
    mlAnomalies: string[],
    behavioralFlags: any
  ): { decision: 'approved' | 'rejected' | 'requires_human_review'; reason?: string; confidence: number } {
    let decision: 'approved' | 'rejected' | 'requires_human_review';
    let reason: string | undefined;
    let confidence: number;

    // Check for automatic rejection conditions
    if (genuinenessScore < this.thresholds.genuineness.autoReject) {
      decision = 'rejected';
      reason = 'Failed genuineness check';
      confidence = 0.9;
    } else if (behavioralRiskScore > this.thresholds.behavioral.autoReject) {
      decision = 'rejected';
      reason = 'High behavioral risk';
      confidence = 0.85;
    } else if (mlAnomalies.includes('contains_links') || mlAnomalies.includes('contains_phone')) {
      decision = 'rejected';
      reason = 'Contains prohibited content';
      confidence = 1.0;
    } else if (combinedScore < this.thresholds.combined.autoReject) {
      decision = 'rejected';
      reason = 'Low combined score';
      confidence = 0.8;
    }
    // Check for automatic approval conditions
    else if (
      genuinenessScore > this.thresholds.genuineness.autoApprove &&
      behavioralRiskScore < 0.2 &&
      mlAnomalies.length === 0
    ) {
      decision = 'approved';
      confidence = 0.95;
    } else if (combinedScore > this.thresholds.combined.autoApprove) {
      decision = 'approved';
      confidence = 0.85;
    }
    // Send for human review
    else {
      decision = 'requires_human_review';
      reason = this.determineReviewReason(mlAnomalies, behavioralFlags);
      confidence = 0.5;
    }

    return { decision, reason, confidence };
  }

  private determineReviewReason(mlAnomalies: string[], behavioralFlags: any): string {
    const reasons: string[] = [];

    if (mlAnomalies.length > 0) {
      reasons.push(`ML anomalies: ${mlAnomalies.join(', ')}`);
    }

    const flaggedBehaviors = Object.keys(behavioralFlags).filter(k => behavioralFlags[k]);
    if (flaggedBehaviors.length > 0) {
      reasons.push(`Behavioral flags: ${flaggedBehaviors.join(', ')}`);
    }

    return reasons.join('; ') || 'Borderline scores';
  }

  private async storeModerationResult(reviewId: string, result: ModerationResult): Promise<void> {
    try {
      await db()('review_moderation_history').insert({
        moderation_id: uuidv4(),
        review_id: reviewId,
        action: result.decision,
        reason: result.reason,
        ml_score: result.genuinenessScore,
        behavioral_flags: JSON.stringify(result.behavioralFlags),
        created_at: new Date(),
      });

      // Cache result for quick access
      const cacheKey = `moderation:${reviewId}`;
      await redis().setex(cacheKey, 3600, JSON.stringify(result));
    } catch (error) {
      logger.error(`Failed to store moderation result for ${reviewId}:`, error);
    }
  }

  private async handleDecision(review: Review, decision: any): Promise<void> {
    try {
      switch (decision.decision) {
        case 'approved':
          await this.approveReview(review);
          break;
        case 'rejected':
          await this.rejectReview(review, decision.reason);
          break;
        case 'requires_human_review':
          await this.queueForHumanReview(review, decision.reason);
          break;
      }
    } catch (error) {
      logger.error(`Failed to handle decision for review ${review.reviewId}:`, error);
    }
  }

  private async approveReview(review: Review): Promise<void> {
    // Update review status
    await db()('reviews')
      .where('review_id', review.reviewId)
      .update({
        moderation_status: 'approved',
        updated_at: new Date(),
      });

    // Publish approval event
    await publishEvent('review.approved', {
      reviewId: review.reviewId,
      productId: review.productId,
      userId: review.userId,
      sellerId: review.sellerId,
      rating: review.rating,
    });

    // Award loyalty points if eligible
    if (!review.isIncentivized) {
      await this.awardLoyaltyPoints(review);
    }

    logger.info(`Review ${review.reviewId} approved`);
  }

  private async rejectReview(review: Review, reason: string): Promise<void> {
    // Update review status
    await db()('reviews')
      .where('review_id', review.reviewId)
      .update({
        moderation_status: 'rejected',
        rejection_reason: reason,
        updated_at: new Date(),
      });

    // Publish rejection event
    await publishEvent('review.rejected', {
      reviewId: review.reviewId,
      userId: review.userId,
      reason,
    });

    // Track user for potential blocking
    await this.trackSuspiciousUser(review.userId);

    logger.info(`Review ${review.reviewId} rejected: ${reason}`);
  }

  private async queueForHumanReview(review: Review, reason: string): Promise<void> {
    // Add to human review queue
    await db()('human_review_queue').insert({
      queue_id: uuidv4(),
      review_id: review.reviewId,
      priority: this.calculatePriority(review),
      reason,
      queued_at: new Date(),
    });

    // Update review status
    await db()('reviews')
      .where('review_id', review.reviewId)
      .update({
        moderation_status: 'pending_review',
        updated_at: new Date(),
      });

    // Publish event for moderator notification
    await publishEvent('review.queued_for_moderation', {
      reviewId: review.reviewId,
      reason,
    });

    logger.info(`Review ${review.reviewId} queued for human review`);
  }

  private calculatePriority(review: Review): number {
    // Higher rating reviews get higher priority
    // Verified purchases get higher priority
    let priority = review.rating;
    if (review.isVerifiedPurchase) {
      priority += 2;
    }
    return Math.min(10, priority);
  }

  private async awardLoyaltyPoints(review: Review): Promise<void> {
    try {
      // Calculate points based on review quality
      let points = 50; // Base points for text review

      if (review.photoUrls && review.photoUrls.length > 0) {
        points += 50; // Additional points for photos
      }

      if (review.videoUrl) {
        points += 150; // Additional points for video
      }

      if (review.reviewText.length > 100) {
        points += 25; // Bonus for detailed review
      }

      // Publish event to loyalty service
      await publishEvent('loyalty.points.earned', {
        userId: review.userId,
        points,
        source: 'review_submission',
        referenceId: review.reviewId,
      });
    } catch (error) {
      logger.error(`Failed to award loyalty points for review ${review.reviewId}:`, error);
    }
  }

  private async trackSuspiciousUser(userId: string): Promise<void> {
    try {
      const suspicionKey = `suspicious:user:${userId}`;
      const count = await redis().incr(suspicionKey);
      await redis().expire(suspicionKey, 2592000); // 30 days

      if (count >= 5) {
        // Flag user for review
        await db()('user_flags').insert({
          user_id: userId,
          flag_type: 'suspicious_review_activity',
          flagged_at: new Date(),
        }).onConflict(['user_id', 'flag_type']).merge();

        logger.warn(`User ${userId} flagged for suspicious activity`);
      }
    } catch (error) {
      logger.error(`Failed to track suspicious user ${userId}:`, error);
    }
  }

  private async getUserReviewCount(userId: string): Promise<number> {
    const result = await db()('reviews')
      .where('user_id', userId)
      .count('* as count')
      .first();

    return parseInt(result?.count || '0');
  }

  private async getUserRatingVariance(userId: string): Promise<number> {
    const ratings = await db()('reviews')
      .where('user_id', userId)
      .select('rating')
      .limit(20);

    if (ratings.length < 2) {
      return 0;
    }

    const values = ratings.map(r => r.rating);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  async bulkModerate(reviews: Review[]): Promise<ModerationResult[]> {
    const results: ModerationResult[] = [];

    // Process in batches to avoid overwhelming the system
    const batchSize = 10;
    for (let i = 0; i < reviews.length; i += batchSize) {
      const batch = reviews.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(review => this.moderateReview(review))
      );
      results.push(...batchResults);
    }

    return results;
  }

  async getModrationStats(timeWindow: number = 86400000): Promise<any> {
    const startTime = new Date(Date.now() - timeWindow);

    const stats = await db()('review_moderation_history')
      .where('created_at', '>=', startTime)
      .select('action')
      .count('* as count')
      .groupBy('action');

    const total = stats.reduce((sum, s) => sum + parseInt(s.count), 0);

    return {
      total,
      approved: stats.find(s => s.action === 'approved')?.count || 0,
      rejected: stats.find(s => s.action === 'rejected')?.count || 0,
      pending_review: stats.find(s => s.action === 'requires_human_review')?.count || 0,
      approval_rate: total > 0 ?
        (stats.find(s => s.action === 'approved')?.count || 0) / total : 0,
    };
  }
}

export const reviewModerationService = new ReviewModerationService();