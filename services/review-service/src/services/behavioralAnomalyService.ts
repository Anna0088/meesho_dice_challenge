import { getDatabase } from '../config/database';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import crypto from 'crypto';

const db = getDatabase;
const redis = getRedisClient;

interface BehavioralFlags {
  velocityAnomaly: boolean;
  ipClusterAnomaly: boolean;
  deviceFingerprintAnomaly: boolean;
  timingPatternAnomaly: boolean;
  ratingPatternAnomaly: boolean;
  reviewHistoryAnomaly: boolean;
  accountAgeAnomaly: boolean;
  purchasePatternAnomaly: boolean;
}

interface ReviewMetadata {
  userId: string;
  productId: string;
  sellerId: string;
  ipAddress: string;
  deviceFingerprint: string;
  userAgent: string;
  timestamp: Date;
  rating: number;
  isVerifiedPurchase: boolean;
  accountAge: number; // in days
}

export class BehavioralAnomalyService {
  private readonly thresholds = {
    velocity: {
      reviewsPerHour: 3,
      reviewsPerDay: 10,
      reviewsPerWeek: 30,
    },
    ipCluster: {
      maxUsersPerIP: 5,
      timeWindow: 86400000, // 24 hours in ms
    },
    timing: {
      minTimeBetweenReviews: 300000, // 5 minutes in ms
      suspiciousHours: [2, 3, 4, 5], // 2 AM - 5 AM
    },
    account: {
      minAgeForMultipleReviews: 7, // days
      maxReviewsForNewAccount: 3,
    },
    rating: {
      maxConsecutiveSameRating: 5,
      minRatingVariance: 0.5,
    },
  };

  async detectAnomalies(metadata: ReviewMetadata): Promise<BehavioralFlags> {
    try {
      const [
        velocityAnomaly,
        ipClusterAnomaly,
        deviceFingerprintAnomaly,
        timingPatternAnomaly,
        ratingPatternAnomaly,
        reviewHistoryAnomaly,
        accountAgeAnomaly,
        purchasePatternAnomaly,
      ] = await Promise.all([
        this.checkVelocityAnomaly(metadata.userId),
        this.checkIPClusterAnomaly(metadata.ipAddress, metadata.userId),
        this.checkDeviceFingerprintAnomaly(metadata.deviceFingerprint, metadata.userId),
        this.checkTimingPattern(metadata.userId, metadata.timestamp),
        this.checkRatingPattern(metadata.userId, metadata.rating),
        this.checkReviewHistoryAnomaly(metadata.userId),
        this.checkAccountAgeAnomaly(metadata.accountAge, metadata.userId),
        this.checkPurchasePattern(metadata.userId, metadata.productId, metadata.isVerifiedPurchase),
      ]);

      const flags: BehavioralFlags = {
        velocityAnomaly,
        ipClusterAnomaly,
        deviceFingerprintAnomaly,
        timingPatternAnomaly,
        ratingPatternAnomaly,
        reviewHistoryAnomaly,
        accountAgeAnomaly,
        purchasePatternAnomaly,
      };

      // Log anomalies for monitoring
      if (this.hasAnomalies(flags)) {
        await this.logAnomalies(metadata, flags);
      }

      return flags;
    } catch (error) {
      logger.error('Failed to detect behavioral anomalies:', error);
      return this.getDefaultFlags();
    }
  }

  private async checkVelocityAnomaly(userId: string): Promise<boolean> {
    try {
      const now = Date.now();
      const hourKey = `velocity:hour:${userId}`;
      const dayKey = `velocity:day:${userId}`;
      const weekKey = `velocity:week:${userId}`;

      // Increment counters
      const [hourCount, dayCount, weekCount] = await Promise.all([
        this.incrementTimedCounter(hourKey, 3600),
        this.incrementTimedCounter(dayKey, 86400),
        this.incrementTimedCounter(weekKey, 604800),
      ]);

      // Check against thresholds
      return (
        hourCount > this.thresholds.velocity.reviewsPerHour ||
        dayCount > this.thresholds.velocity.reviewsPerDay ||
        weekCount > this.thresholds.velocity.reviewsPerWeek
      );
    } catch (error) {
      logger.error('Failed to check velocity anomaly:', error);
      return false;
    }
  }

  private async checkIPClusterAnomaly(ipAddress: string, userId: string): Promise<boolean> {
    try {
      const ipKey = `ip:cluster:${ipAddress}`;
      const ipHash = this.hashIP(ipAddress);

      // Add user to IP cluster set
      await redis().zadd(ipKey, Date.now(), userId);
      await redis().expire(ipKey, 86400); // Expire after 24 hours

      // Get users from same IP in time window
      const windowStart = Date.now() - this.thresholds.ipCluster.timeWindow;
      const usersFromIP = await redis().zrangebyscore(ipKey, windowStart, '+inf');

      // Check if too many users from same IP
      const uniqueUsers = new Set(usersFromIP);
      return uniqueUsers.size > this.thresholds.ipCluster.maxUsersPerIP;
    } catch (error) {
      logger.error('Failed to check IP cluster anomaly:', error);
      return false;
    }
  }

  private async checkDeviceFingerprintAnomaly(
    deviceFingerprint: string,
    userId: string
  ): Promise<boolean> {
    try {
      const fingerprintKey = `device:${deviceFingerprint}`;

      // Track users per device
      await redis().sadd(fingerprintKey, userId);
      await redis().expire(fingerprintKey, 86400);

      // Get all users for this device
      const users = await redis().smembers(fingerprintKey);

      // Anomaly if multiple users share exact same device fingerprint
      return users.length > 2;
    } catch (error) {
      logger.error('Failed to check device fingerprint anomaly:', error);
      return false;
    }
  }

  private async checkTimingPattern(userId: string, timestamp: Date): Promise<boolean> {
    try {
      const lastReviewKey = `last:review:${userId}`;
      const hour = timestamp.getHours();

      // Check suspicious hours
      const isSuspiciousHour = this.thresholds.timing.suspiciousHours.includes(hour);

      // Get last review timestamp
      const lastReviewTime = await redis().get(lastReviewKey);
      const currentTime = timestamp.getTime();

      // Update last review time
      await redis().set(lastReviewKey, currentTime.toString());
      await redis().expire(lastReviewKey, 604800); // 7 days

      if (lastReviewTime) {
        const timeDiff = currentTime - parseInt(lastReviewTime);

        // Check if reviews are too close together
        if (timeDiff < this.thresholds.timing.minTimeBetweenReviews) {
          return true;
        }

        // Check for regular intervals (bot-like behavior)
        const intervalKey = `interval:${userId}`;
        await redis().lpush(intervalKey, timeDiff.toString());
        await redis().ltrim(intervalKey, 0, 9); // Keep last 10 intervals
        await redis().expire(intervalKey, 604800);

        const intervals = await redis().lrange(intervalKey, 0, -1);
        if (intervals.length >= 5) {
          const intervalNums = intervals.map(i => parseInt(i));
          const variance = this.calculateVariance(intervalNums);

          // Low variance indicates regular intervals (bot-like)
          if (variance < 60000) { // Less than 1 minute variance
            return true;
          }
        }
      }

      return isSuspiciousHour;
    } catch (error) {
      logger.error('Failed to check timing pattern:', error);
      return false;
    }
  }

  private async checkRatingPattern(userId: string, rating: number): Promise<boolean> {
    try {
      const ratingKey = `ratings:${userId}`;

      // Store rating history
      await redis().lpush(ratingKey, rating.toString());
      await redis().ltrim(ratingKey, 0, 19); // Keep last 20 ratings
      await redis().expire(ratingKey, 2592000); // 30 days

      const ratings = await redis().lrange(ratingKey, 0, -1);

      if (ratings.length >= 5) {
        const ratingNums = ratings.map(r => parseInt(r));

        // Check for consecutive same ratings
        let consecutiveSame = 1;
        for (let i = 1; i < ratingNums.length; i++) {
          if (ratingNums[i] === ratingNums[i - 1]) {
            consecutiveSame++;
            if (consecutiveSame >= this.thresholds.rating.maxConsecutiveSameRating) {
              return true;
            }
          } else {
            consecutiveSame = 1;
          }
        }

        // Check rating variance
        const variance = this.calculateVariance(ratingNums);
        if (variance < this.thresholds.rating.minRatingVariance) {
          return true;
        }

        // Check for all extreme ratings (all 1s or all 5s)
        const allExtreme = ratingNums.every(r => r === 1 || r === 5);
        if (allExtreme && ratingNums.length >= 10) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Failed to check rating pattern:', error);
      return false;
    }
  }

  private async checkReviewHistoryAnomaly(userId: string): Promise<boolean> {
    try {
      // Check review history from database
      const recentReviews = await db()('reviews')
        .where('user_id', userId)
        .orderBy('created_at', 'desc')
        .limit(50);

      if (recentReviews.length < 5) {
        return false;
      }

      // Check for copy-paste reviews
      const reviewTexts = recentReviews.map(r => r.review_text?.toLowerCase() || '');
      const uniqueTexts = new Set(reviewTexts);

      if (uniqueTexts.size < reviewTexts.length * 0.7) {
        return true; // Too many duplicate reviews
      }

      // Check for review farming patterns
      const sellers = recentReviews.map(r => r.seller_id);
      const sellerCounts = new Map<string, number>();

      for (const seller of sellers) {
        sellerCounts.set(seller, (sellerCounts.get(seller) || 0) + 1);
      }

      // Check if reviewing same seller too frequently
      for (const count of sellerCounts.values()) {
        if (count > recentReviews.length * 0.5) {
          return true; // More than 50% reviews for same seller
        }
      }

      return false;
    } catch (error) {
      logger.error('Failed to check review history anomaly:', error);
      return false;
    }
  }

  private async checkAccountAgeAnomaly(accountAge: number, userId: string): Promise<boolean> {
    try {
      if (accountAge < this.thresholds.account.minAgeForMultipleReviews) {
        // Check review count for new account
        const reviewCount = await db()('reviews')
          .where('user_id', userId)
          .count('* as count')
          .first();

        const count = parseInt(reviewCount?.count || '0');
        return count > this.thresholds.account.maxReviewsForNewAccount;
      }

      return false;
    } catch (error) {
      logger.error('Failed to check account age anomaly:', error);
      return false;
    }
  }

  private async checkPurchasePattern(
    userId: string,
    productId: string,
    isVerifiedPurchase: boolean
  ): Promise<boolean> {
    try {
      if (!isVerifiedPurchase) {
        // Check ratio of unverified reviews
        const [totalReviews, unverifiedReviews] = await Promise.all([
          db()('reviews').where('user_id', userId).count('* as count').first(),
          db()('reviews')
            .where('user_id', userId)
            .where('is_verified_purchase', false)
            .count('* as count')
            .first(),
        ]);

        const total = parseInt(totalReviews?.count || '0');
        const unverified = parseInt(unverifiedReviews?.count || '0');

        if (total > 10 && unverified / total > 0.7) {
          return true; // Too many unverified reviews
        }
      }

      // Check for reviewing without viewing pattern
      const viewKey = `product:view:${userId}:${productId}`;
      const hasViewed = await redis().exists(viewKey);

      if (!hasViewed && !isVerifiedPurchase) {
        return true; // Reviewing without viewing or purchasing
      }

      return false;
    } catch (error) {
      logger.error('Failed to check purchase pattern:', error);
      return false;
    }
  }

  private async incrementTimedCounter(key: string, ttl: number): Promise<number> {
    const count = await redis().incr(key);
    if (count === 1) {
      await redis().expire(key, ttl);
    }
    return count;
  }

  private hashIP(ipAddress: string): string {
    // Hash IP for privacy while maintaining consistency
    return crypto
      .createHash('sha256')
      .update(ipAddress + process.env.IP_SALT || 'default-salt')
      .digest('hex')
      .substring(0, 16);
  }

  private calculateVariance(numbers: number[]): number {
    if (numbers.length === 0) return 0;

    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    const squaredDiffs = numbers.map(n => Math.pow(n - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / numbers.length;
  }

  private hasAnomalies(flags: BehavioralFlags): boolean {
    return Object.values(flags).some(flag => flag === true);
  }

  private async logAnomalies(metadata: ReviewMetadata, flags: BehavioralFlags): Promise<void> {
    try {
      await db()('behavioral_anomaly_logs').insert({
        user_id: metadata.userId,
        product_id: metadata.productId,
        seller_id: metadata.sellerId,
        flags: JSON.stringify(flags),
        metadata: JSON.stringify({
          ip: this.hashIP(metadata.ipAddress),
          device: metadata.deviceFingerprint,
          userAgent: metadata.userAgent,
        }),
        detected_at: new Date(),
      });

      logger.warn('Behavioral anomalies detected', {
        userId: metadata.userId,
        flags: Object.keys(flags).filter(k => flags[k as keyof BehavioralFlags]),
      });
    } catch (error) {
      logger.error('Failed to log anomalies:', error);
    }
  }

  private getDefaultFlags(): BehavioralFlags {
    return {
      velocityAnomaly: false,
      ipClusterAnomaly: false,
      deviceFingerprintAnomaly: false,
      timingPatternAnomaly: false,
      ratingPatternAnomaly: false,
      reviewHistoryAnomaly: false,
      accountAgeAnomaly: false,
      purchasePatternAnomaly: false,
    };
  }

  async calculateRiskScore(flags: BehavioralFlags): Promise<number> {
    // Weight each flag based on importance
    const weights = {
      velocityAnomaly: 0.15,
      ipClusterAnomaly: 0.20,
      deviceFingerprintAnomaly: 0.15,
      timingPatternAnomaly: 0.10,
      ratingPatternAnomaly: 0.10,
      reviewHistoryAnomaly: 0.15,
      accountAgeAnomaly: 0.10,
      purchasePatternAnomaly: 0.05,
    };

    let score = 0;
    for (const [flag, value] of Object.entries(flags)) {
      if (value) {
        score += weights[flag as keyof typeof weights] || 0;
      }
    }

    return Math.min(1, score);
  }
}

export const behavioralAnomalyService = new BehavioralAnomalyService();