import { getDatabase } from '../config/database';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { publishEvent } from '../utils/eventPublisher';
import { v4 as uuidv4 } from 'uuid';

const db = getDatabase;
const redis = getRedisClient;

export enum TransactionType {
  EARN = 'earn',
  REDEEM = 'redeem',
  EXPIRE = 'expire',
  ADJUST = 'adjust'
}

export enum PointSource {
  PURCHASE = 'purchase',
  REVIEW_TEXT = 'review_text',
  REVIEW_PHOTO = 'review_photo',
  REVIEW_VIDEO = 'review_video',
  REVIEW_HELPFUL = 'review_helpful',
  REFERRAL = 'referral',
  ACHIEVEMENT = 'achievement',
  BONUS = 'bonus',
  MISSION = 'mission'
}

interface PointsTransaction {
  userId: string;
  amount: number;
  type: TransactionType;
  source: PointSource;
  sourceReferenceId?: string;
  description: string;
  metadata?: any;
}

export class LoyaltyService {
  private readonly pointsConfig = {
    purchase: {
      rate: 0.1, // 1 star per 10 rupees
      min: 1,
      max: 1000,
    },
    review: {
      text: 50,
      withPhoto: 100,
      withVideo: 250,
      helpful: 5,
      detailedBonus: 25, // For reviews > 100 words
    },
    referral: {
      signup: 100,
      firstPurchase: 200,
    },
    bonus: {
      dailyLogin: 5,
      weeklyStreak: 50,
      monthlyActive: 100,
    },
  };

  async getUserAccount(userId: string): Promise<any> {
    try {
      // Check cache first
      const cacheKey = `loyalty:account:${userId}`;
      const cached = await redis().get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get from database
      let account = await db()('user_loyalty_accounts')
        .where('user_id', userId)
        .first();

      // Create account if doesn't exist
      if (!account) {
        account = await this.createAccount(userId);
      }

      // Cache for 5 minutes
      await redis().setex(cacheKey, 300, JSON.stringify(account));

      return account;
    } catch (error) {
      logger.error(`Failed to get loyalty account for user ${userId}:`, error);
      throw error;
    }
  }

  private async createAccount(userId: string): Promise<any> {
    try {
      const account = {
        user_id: userId,
        current_star_balance: 0,
        lifetime_stars_earned: 0,
        current_tier: 'bronze',
        tier_updated_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      await db()('user_loyalty_accounts').insert(account);

      // Publish account created event
      await publishEvent('loyalty.account.created', {
        userId,
        timestamp: new Date().toISOString(),
      });

      logger.info(`Created loyalty account for user ${userId}`);
      return account;
    } catch (error) {
      logger.error(`Failed to create loyalty account for user ${userId}:`, error);
      throw error;
    }
  }

  async earnPoints(transaction: PointsTransaction): Promise<any> {
    try {
      const { userId, amount, source, sourceReferenceId, description, metadata } = transaction;

      // Validate amount
      if (amount <= 0) {
        throw new Error('Points amount must be positive');
      }

      // Get current account
      const account = await this.getUserAccount(userId);

      // Start transaction
      const trx = await db().transaction();

      try {
        // Update account balance
        const newBalance = account.current_star_balance + amount;
        const newLifetime = account.lifetime_stars_earned + amount;

        await trx('user_loyalty_accounts')
          .where('user_id', userId)
          .update({
            current_star_balance: newBalance,
            lifetime_stars_earned: newLifetime,
            updated_at: new Date(),
          });

        // Record transaction
        const transactionId = uuidv4();
        await trx('points_ledger').insert({
          transaction_id: transactionId,
          user_id: userId,
          amount,
          balance_after: newBalance,
          transaction_type: TransactionType.EARN,
          source_event_id: sourceReferenceId,
          source_event_type: source,
          description,
          metadata: JSON.stringify(metadata || {}),
          created_at: new Date(),
        });

        // Commit transaction
        await trx.commit();

        // Clear cache
        await redis().del(`loyalty:account:${userId}`);

        // Publish points earned event
        await publishEvent('loyalty.points.earned', {
          userId,
          amount,
          source,
          newBalance,
          newLifetime,
          transactionId,
        });

        // Check for tier upgrade
        await this.checkTierProgression(userId, newLifetime);

        // Check for achievement milestones
        await this.checkAchievementMilestones(userId, source, amount);

        logger.info(`User ${userId} earned ${amount} stars from ${source}`);

        return {
          success: true,
          transactionId,
          pointsEarned: amount,
          newBalance,
          message: `You earned ${amount} stars!`,
        };
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Failed to earn points for user ${transaction.userId}:`, error);
      throw error;
    }
  }

  async redeemPoints(userId: string, rewardId: string, pointsCost: number): Promise<any> {
    try {
      // Get current account
      const account = await this.getUserAccount(userId);

      // Check sufficient balance
      if (account.current_star_balance < pointsCost) {
        throw new Error('Insufficient star balance');
      }

      // Start transaction
      const trx = await db().transaction();

      try {
        // Update account balance
        const newBalance = account.current_star_balance - pointsCost;

        await trx('user_loyalty_accounts')
          .where('user_id', userId)
          .update({
            current_star_balance: newBalance,
            updated_at: new Date(),
          });

        // Record transaction
        const transactionId = uuidv4();
        await trx('points_ledger').insert({
          transaction_id: transactionId,
          user_id: userId,
          amount: -pointsCost,
          balance_after: newBalance,
          transaction_type: TransactionType.REDEEM,
          source_event_id: rewardId,
          source_event_type: 'reward_redemption',
          description: `Redeemed reward ${rewardId}`,
          created_at: new Date(),
        });

        // Create redemption record
        const redemptionCode = this.generateRedemptionCode();
        const redemptionId = uuidv4();

        await trx('reward_redemptions').insert({
          redemption_id: redemptionId,
          user_id: userId,
          reward_id: rewardId,
          stars_spent: pointsCost,
          redemption_code: redemptionCode,
          status: 'pending',
          created_at: new Date(),
        });

        // Commit transaction
        await trx.commit();

        // Clear cache
        await redis().del(`loyalty:account:${userId}`);

        // Publish redemption event
        await publishEvent('loyalty.points.redeemed', {
          userId,
          rewardId,
          pointsRedeemed: pointsCost,
          newBalance,
          redemptionId,
          redemptionCode,
        });

        logger.info(`User ${userId} redeemed ${pointsCost} stars for reward ${rewardId}`);

        return {
          success: true,
          redemptionId,
          redemptionCode,
          pointsRedeemed: pointsCost,
          newBalance,
          message: 'Reward redeemed successfully!',
        };
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Failed to redeem points for user ${userId}:`, error);
      throw error;
    }
  }

  async getPointsHistory(userId: string, limit: number = 50): Promise<any[]> {
    try {
      const history = await db()('points_ledger')
        .where('user_id', userId)
        .orderBy('created_at', 'desc')
        .limit(limit);

      return history.map(transaction => ({
        ...transaction,
        metadata: transaction.metadata ? JSON.parse(transaction.metadata) : {},
      }));
    } catch (error) {
      logger.error(`Failed to get points history for user ${userId}:`, error);
      throw error;
    }
  }

  async calculatePointsForPurchase(amount: number): Promise<number> {
    const points = Math.floor(amount * this.pointsConfig.purchase.rate);
    return Math.min(
      this.pointsConfig.purchase.max,
      Math.max(this.pointsConfig.purchase.min, points)
    );
  }

  async calculatePointsForReview(
    hasText: boolean,
    hasPhotos: boolean,
    hasVideo: boolean,
    textLength: number
  ): Promise<number> {
    let points = 0;

    if (hasVideo) {
      points = this.pointsConfig.review.withVideo;
    } else if (hasPhotos) {
      points = this.pointsConfig.review.withPhoto;
    } else if (hasText) {
      points = this.pointsConfig.review.text;
    }

    // Add bonus for detailed reviews
    if (textLength > 100) {
      points += this.pointsConfig.review.detailedBonus;
    }

    return points;
  }

  private async checkTierProgression(userId: string, lifetimePoints: number): Promise<void> {
    try {
      const tierThresholds = {
        bronze: 0,
        silver: 500,
        gold: 2500,
        platinum: 10000,
      };

      let newTier = 'bronze';
      if (lifetimePoints >= tierThresholds.platinum) {
        newTier = 'platinum';
      } else if (lifetimePoints >= tierThresholds.gold) {
        newTier = 'gold';
      } else if (lifetimePoints >= tierThresholds.silver) {
        newTier = 'silver';
      }

      // Get current tier
      const account = await db()('user_loyalty_accounts')
        .where('user_id', userId)
        .first();

      if (account.current_tier !== newTier) {
        // Update tier
        await db()('user_loyalty_accounts')
          .where('user_id', userId)
          .update({
            current_tier: newTier,
            tier_updated_at: new Date(),
          });

        // Publish tier change event
        await publishEvent('loyalty.tier.changed', {
          userId,
          oldTier: account.current_tier,
          newTier,
          lifetimePoints,
        });

        logger.info(`User ${userId} progressed from ${account.current_tier} to ${newTier}`);
      }
    } catch (error) {
      logger.error(`Failed to check tier progression for user ${userId}:`, error);
    }
  }

  private async checkAchievementMilestones(
    userId: string,
    source: PointSource,
    amount: number
  ): Promise<void> {
    try {
      // Check various achievement conditions
      const achievements = await this.getEligibleAchievements(userId, source);

      for (const achievement of achievements) {
        await this.unlockAchievement(userId, achievement.achievement_id);
      }
    } catch (error) {
      logger.error(`Failed to check achievements for user ${userId}:`, error);
    }
  }

  private async getEligibleAchievements(userId: string, source: PointSource): Promise<any[]> {
    // Get user's stats
    const stats = await this.getUserStats(userId);

    // Get all active achievements
    const achievements = await db()('achievements')
      .where('is_active', true);

    // Check eligibility
    const eligible = [];
    for (const achievement of achievements) {
      const criteria = JSON.parse(achievement.criteria);

      // Check if already earned
      const earned = await db()('user_achievements')
        .where('user_id', userId)
        .where('achievement_id', achievement.achievement_id)
        .first();

      if (!earned && this.meetsCriteria(stats, criteria)) {
        eligible.push(achievement);
      }
    }

    return eligible;
  }

  private meetsCriteria(stats: any, criteria: any): boolean {
    // Implement criteria checking logic
    if (criteria.totalReviews && stats.totalReviews < criteria.totalReviews) {
      return false;
    }

    if (criteria.totalPurchases && stats.totalPurchases < criteria.totalPurchases) {
      return false;
    }

    if (criteria.lifetimePoints && stats.lifetimePoints < criteria.lifetimePoints) {
      return false;
    }

    return true;
  }

  private async getUserStats(userId: string): Promise<any> {
    const [reviewCount, purchaseCount, account] = await Promise.all([
      db()('reviews').where('user_id', userId).count('* as count').first(),
      db()('orders').where('user_id', userId).count('* as count').first(),
      this.getUserAccount(userId),
    ]);

    return {
      totalReviews: parseInt(reviewCount?.count || '0'),
      totalPurchases: parseInt(purchaseCount?.count || '0'),
      lifetimePoints: account.lifetime_stars_earned,
    };
  }

  private async unlockAchievement(userId: string, achievementId: string): Promise<void> {
    try {
      // Record achievement
      await db()('user_achievements').insert({
        user_id: userId,
        achievement_id: achievementId,
        earned_at: new Date(),
      });

      // Get achievement details
      const achievement = await db()('achievements')
        .where('achievement_id', achievementId)
        .first();

      // Award bonus points
      if (achievement.points_reward > 0) {
        await this.earnPoints({
          userId,
          amount: achievement.points_reward,
          type: TransactionType.EARN,
          source: PointSource.ACHIEVEMENT,
          sourceReferenceId: achievementId,
          description: `Unlocked achievement: ${achievement.name}`,
        });
      }

      // Publish achievement unlocked event
      await publishEvent('loyalty.achievement.unlocked', {
        userId,
        achievementId,
        achievementName: achievement.name,
        pointsAwarded: achievement.points_reward,
      });

      logger.info(`User ${userId} unlocked achievement ${achievement.name}`);
    } catch (error) {
      logger.error(`Failed to unlock achievement ${achievementId} for user ${userId}:`, error);
    }
  }

  private generateRedemptionCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 12; i++) {
      if (i > 0 && i % 4 === 0) {
        code += '-';
      }
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  async getLeaderboard(period: 'weekly' | 'monthly' | 'alltime', limit: number = 10): Promise<any[]> {
    try {
      let startDate: Date | null = null;

      if (period === 'weekly') {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
      } else if (period === 'monthly') {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
      }

      let query = db()('points_ledger')
        .select('user_id')
        .sum('amount as total_points')
        .where('transaction_type', TransactionType.EARN)
        .groupBy('user_id')
        .orderBy('total_points', 'desc')
        .limit(limit);

      if (startDate) {
        query = query.where('created_at', '>=', startDate);
      }

      const leaderboard = await query;

      // Enhance with user details
      for (const entry of leaderboard) {
        const account = await this.getUserAccount(entry.user_id);
        entry.tier = account.current_tier;
        entry.rank = leaderboard.indexOf(entry) + 1;
      }

      return leaderboard;
    } catch (error) {
      logger.error(`Failed to get leaderboard:`, error);
      throw error;
    }
  }
}

export const loyaltyService = new LoyaltyService();