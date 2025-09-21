import { getDatabase } from '../config/database';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { publishEvent } from '../utils/eventPublisher';
import { loyaltyService } from './loyaltyService';
import { v4 as uuidv4 } from 'uuid';

const db = getDatabase;
const redis = getRedisClient;

interface Achievement {
  id: string;
  name: string;
  description: string;
  category: string;
  iconUrl: string;
  pointsReward: number;
  criteria: AchievementCriteria;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  isSecret: boolean;
}

interface AchievementCriteria {
  type: string;
  requirement: number;
  timeframe?: number; // in days
  additionalConditions?: any;
}

interface Mission {
  id: string;
  title: string;
  description: string;
  objectives: MissionObjective[];
  rewards: MissionReward;
  startTime: Date;
  endTime: Date;
  isActive: boolean;
}

interface MissionObjective {
  type: string;
  target: number;
  progress?: number;
  description: string;
}

interface MissionReward {
  points: number;
  badges?: string[];
  bonusMultiplier?: number;
}

export class GamificationService {
  private achievements: Map<string, Achievement> = new Map();

  constructor() {
    this.initializeAchievements();
  }

  private initializeAchievements(): void {
    // Define all achievements
    const achievementsList: Achievement[] = [
      // Review Achievements
      {
        id: 'first_review',
        name: 'First Steps',
        description: 'Write your first review',
        category: 'reviews',
        iconUrl: '/badges/first_review.svg',
        pointsReward: 50,
        criteria: { type: 'review_count', requirement: 1 },
        rarity: 'common',
        isSecret: false,
      },
      {
        id: 'review_veteran',
        name: 'Review Veteran',
        description: 'Write 50 reviews',
        category: 'reviews',
        iconUrl: '/badges/review_veteran.svg',
        pointsReward: 500,
        criteria: { type: 'review_count', requirement: 50 },
        rarity: 'rare',
        isSecret: false,
      },
      {
        id: 'photo_reviewer',
        name: 'Picture Perfect',
        description: 'Submit 10 reviews with photos',
        category: 'reviews',
        iconUrl: '/badges/photo_reviewer.svg',
        pointsReward: 200,
        criteria: { type: 'photo_review_count', requirement: 10 },
        rarity: 'rare',
        isSecret: false,
      },
      {
        id: 'video_star',
        name: 'Video Star',
        description: 'Submit 5 video reviews',
        category: 'reviews',
        iconUrl: '/badges/video_star.svg',
        pointsReward: 1000,
        criteria: { type: 'video_review_count', requirement: 5 },
        rarity: 'epic',
        isSecret: false,
      },
      {
        id: 'helpful_reviewer',
        name: 'Community Helper',
        description: 'Receive 100 helpful votes on your reviews',
        category: 'reviews',
        iconUrl: '/badges/helpful_reviewer.svg',
        pointsReward: 300,
        criteria: { type: 'helpful_votes', requirement: 100 },
        rarity: 'rare',
        isSecret: false,
      },

      // Shopping Achievements
      {
        id: 'first_purchase',
        name: 'Welcome Shopper',
        description: 'Make your first purchase',
        category: 'shopping',
        iconUrl: '/badges/first_purchase.svg',
        pointsReward: 100,
        criteria: { type: 'purchase_count', requirement: 1 },
        rarity: 'common',
        isSecret: false,
      },
      {
        id: 'shopaholic',
        name: 'Shopaholic',
        description: 'Make 100 purchases',
        category: 'shopping',
        iconUrl: '/badges/shopaholic.svg',
        pointsReward: 1000,
        criteria: { type: 'purchase_count', requirement: 100 },
        rarity: 'epic',
        isSecret: false,
      },
      {
        id: 'category_explorer',
        name: 'Category Explorer',
        description: 'Shop from 10 different categories',
        category: 'shopping',
        iconUrl: '/badges/category_explorer.svg',
        pointsReward: 250,
        criteria: { type: 'category_diversity', requirement: 10 },
        rarity: 'rare',
        isSecret: false,
      },

      // Engagement Achievements
      {
        id: 'daily_visitor',
        name: 'Daily Visitor',
        description: 'Visit the app for 7 consecutive days',
        category: 'engagement',
        iconUrl: '/badges/daily_visitor.svg',
        pointsReward: 100,
        criteria: { type: 'login_streak', requirement: 7 },
        rarity: 'common',
        isSecret: false,
      },
      {
        id: 'loyal_customer',
        name: 'Loyal Customer',
        description: 'Be active for 365 days',
        category: 'engagement',
        iconUrl: '/badges/loyal_customer.svg',
        pointsReward: 2000,
        criteria: { type: 'account_age', requirement: 365 },
        rarity: 'legendary',
        isSecret: false,
      },
      {
        id: 'social_butterfly',
        name: 'Social Butterfly',
        description: 'Refer 10 friends who make their first purchase',
        category: 'social',
        iconUrl: '/badges/social_butterfly.svg',
        pointsReward: 1500,
        criteria: { type: 'successful_referrals', requirement: 10 },
        rarity: 'epic',
        isSecret: false,
      },

      // Secret Achievements
      {
        id: 'night_owl',
        name: 'Night Owl',
        description: 'Make a purchase between 2 AM and 5 AM',
        category: 'secret',
        iconUrl: '/badges/night_owl.svg',
        pointsReward: 100,
        criteria: {
          type: 'purchase_time',
          requirement: 1,
          additionalConditions: { hourRange: [2, 5] },
        },
        rarity: 'rare',
        isSecret: true,
      },
      {
        id: 'perfectionist',
        name: 'Perfectionist',
        description: 'Give exactly 100 5-star reviews',
        category: 'secret',
        iconUrl: '/badges/perfectionist.svg',
        pointsReward: 500,
        criteria: {
          type: 'perfect_reviews',
          requirement: 100,
        },
        rarity: 'epic',
        isSecret: true,
      },
    ];

    for (const achievement of achievementsList) {
      this.achievements.set(achievement.id, achievement);
    }
  }

  async checkAndUnlockAchievements(userId: string, eventType: string, eventData: any): Promise<Achievement[]> {
    try {
      const unlockedAchievements: Achievement[] = [];

      // Get user's current achievements
      const userAchievements = await this.getUserAchievements(userId);
      const earnedIds = new Set(userAchievements.map(a => a.achievement_id));

      // Get user stats
      const userStats = await this.getUserStats(userId);

      // Check each achievement
      for (const [id, achievement] of this.achievements) {
        // Skip if already earned
        if (earnedIds.has(id)) continue;

        // Check if criteria is met
        if (await this.checkCriteria(achievement.criteria, userStats, eventType, eventData)) {
          await this.unlockAchievement(userId, achievement);
          unlockedAchievements.push(achievement);
        }
      }

      return unlockedAchievements;
    } catch (error) {
      logger.error(`Failed to check achievements for user ${userId}:`, error);
      return [];
    }
  }

  private async checkCriteria(
    criteria: AchievementCriteria,
    userStats: any,
    eventType: string,
    eventData: any
  ): Promise<boolean> {
    switch (criteria.type) {
      case 'review_count':
        return userStats.reviewCount >= criteria.requirement;

      case 'photo_review_count':
        return userStats.photoReviewCount >= criteria.requirement;

      case 'video_review_count':
        return userStats.videoReviewCount >= criteria.requirement;

      case 'helpful_votes':
        return userStats.helpfulVotes >= criteria.requirement;

      case 'purchase_count':
        return userStats.purchaseCount >= criteria.requirement;

      case 'category_diversity':
        return userStats.uniqueCategories >= criteria.requirement;

      case 'login_streak':
        return userStats.loginStreak >= criteria.requirement;

      case 'account_age':
        const accountAge = Math.floor(
          (Date.now() - new Date(userStats.accountCreated).getTime()) / (1000 * 60 * 60 * 24)
        );
        return accountAge >= criteria.requirement;

      case 'successful_referrals':
        return userStats.successfulReferrals >= criteria.requirement;

      case 'purchase_time':
        if (eventType === 'purchase' && criteria.additionalConditions) {
          const hour = new Date().getHours();
          const [minHour, maxHour] = criteria.additionalConditions.hourRange;
          return hour >= minHour && hour <= maxHour;
        }
        return false;

      case 'perfect_reviews':
        return userStats.fiveStarReviews >= criteria.requirement;

      default:
        return false;
    }
  }

  private async getUserStats(userId: string): Promise<any> {
    try {
      // Get various stats from database
      const [
        reviewStats,
        purchaseStats,
        engagementStats,
        referralStats,
      ] = await Promise.all([
        this.getReviewStats(userId),
        this.getPurchaseStats(userId),
        this.getEngagementStats(userId),
        this.getReferralStats(userId),
      ]);

      return {
        ...reviewStats,
        ...purchaseStats,
        ...engagementStats,
        ...referralStats,
      };
    } catch (error) {
      logger.error(`Failed to get user stats for ${userId}:`, error);
      return {};
    }
  }

  private async getReviewStats(userId: string): Promise<any> {
    const reviews = await db()('reviews')
      .where('user_id', userId)
      .select('rating', 'photo_urls', 'video_url', 'helpful_votes');

    return {
      reviewCount: reviews.length,
      photoReviewCount: reviews.filter(r => r.photo_urls && r.photo_urls.length > 0).length,
      videoReviewCount: reviews.filter(r => r.video_url).length,
      helpfulVotes: reviews.reduce((sum, r) => sum + (r.helpful_votes || 0), 0),
      fiveStarReviews: reviews.filter(r => r.rating === 5).length,
    };
  }

  private async getPurchaseStats(userId: string): Promise<any> {
    const purchases = await db()('orders')
      .where('user_id', userId)
      .select('category');

    const categories = new Set(purchases.map(p => p.category));

    return {
      purchaseCount: purchases.length,
      uniqueCategories: categories.size,
    };
  }

  private async getEngagementStats(userId: string): Promise<any> {
    // Get login streak from Redis
    const streakKey = `login:streak:${userId}`;
    const loginStreak = parseInt(await redis().get(streakKey) || '0');

    // Get account creation date
    const account = await db()('user_loyalty_accounts')
      .where('user_id', userId)
      .first();

    return {
      loginStreak,
      accountCreated: account?.created_at || new Date(),
    };
  }

  private async getReferralStats(userId: string): Promise<any> {
    const referrals = await db()('referrals')
      .where('referrer_id', userId)
      .where('status', 'completed')
      .count('* as count')
      .first();

    return {
      successfulReferrals: parseInt(referrals?.count || '0'),
    };
  }

  private async unlockAchievement(userId: string, achievement: Achievement): Promise<void> {
    try {
      // Save to database
      await db()('user_achievements').insert({
        user_id: userId,
        achievement_id: achievement.id,
        earned_at: new Date(),
      });

      // Award points
      if (achievement.pointsReward > 0) {
        await loyaltyService.earnPoints({
          userId,
          amount: achievement.pointsReward,
          type: require('./loyaltyService').TransactionType.EARN,
          source: require('./loyaltyService').PointSource.ACHIEVEMENT,
          sourceReferenceId: achievement.id,
          description: `Unlocked achievement: ${achievement.name}`,
        });
      }

      // Publish event
      await publishEvent('gamification.achievement.unlocked', {
        userId,
        achievementId: achievement.id,
        achievementName: achievement.name,
        rarity: achievement.rarity,
        pointsAwarded: achievement.pointsReward,
      });

      // Cache achievement
      const cacheKey = `achievements:${userId}`;
      await redis().del(cacheKey); // Clear cache to force refresh

      logger.info(`User ${userId} unlocked achievement: ${achievement.name}`);
    } catch (error) {
      logger.error(`Failed to unlock achievement ${achievement.id} for user ${userId}:`, error);
    }
  }

  async getUserAchievements(userId: string): Promise<any[]> {
    try {
      // Check cache
      const cacheKey = `achievements:${userId}`;
      const cached = await redis().get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get from database
      const achievements = await db()('user_achievements')
        .where('user_id', userId)
        .join('achievements', 'user_achievements.achievement_id', 'achievements.achievement_id')
        .select('achievements.*', 'user_achievements.earned_at');

      // Cache for 1 hour
      await redis().setex(cacheKey, 3600, JSON.stringify(achievements));

      return achievements;
    } catch (error) {
      logger.error(`Failed to get achievements for user ${userId}:`, error);
      return [];
    }
  }

  async getAchievementProgress(userId: string): Promise<any[]> {
    try {
      const userStats = await this.getUserStats(userId);
      const earnedAchievements = await this.getUserAchievements(userId);
      const earnedIds = new Set(earnedAchievements.map(a => a.achievement_id));

      const progress = [];

      for (const [id, achievement] of this.achievements) {
        if (earnedIds.has(id)) {
          progress.push({
            ...achievement,
            earned: true,
            earnedAt: earnedAchievements.find(a => a.achievement_id === id)?.earned_at,
            progress: 100,
          });
        } else if (!achievement.isSecret) {
          const currentProgress = this.calculateProgress(achievement.criteria, userStats);
          progress.push({
            ...achievement,
            earned: false,
            progress: currentProgress,
          });
        }
      }

      return progress;
    } catch (error) {
      logger.error(`Failed to get achievement progress for user ${userId}:`, error);
      return [];
    }
  }

  private calculateProgress(criteria: AchievementCriteria, userStats: any): number {
    let current = 0;

    switch (criteria.type) {
      case 'review_count':
        current = userStats.reviewCount || 0;
        break;
      case 'photo_review_count':
        current = userStats.photoReviewCount || 0;
        break;
      case 'video_review_count':
        current = userStats.videoReviewCount || 0;
        break;
      case 'helpful_votes':
        current = userStats.helpfulVotes || 0;
        break;
      case 'purchase_count':
        current = userStats.purchaseCount || 0;
        break;
      case 'category_diversity':
        current = userStats.uniqueCategories || 0;
        break;
      case 'login_streak':
        current = userStats.loginStreak || 0;
        break;
      case 'successful_referrals':
        current = userStats.successfulReferrals || 0;
        break;
      case 'perfect_reviews':
        current = userStats.fiveStarReviews || 0;
        break;
    }

    return Math.min(100, Math.round((current / criteria.requirement) * 100));
  }

  async createMission(mission: Mission): Promise<void> {
    try {
      await db()('missions').insert({
        mission_id: mission.id,
        title: mission.title,
        description: mission.description,
        objectives: JSON.stringify(mission.objectives),
        rewards: JSON.stringify(mission.rewards),
        start_time: mission.startTime,
        end_time: mission.endTime,
        is_active: mission.isActive,
      });

      // Publish mission created event
      await publishEvent('gamification.mission.created', {
        missionId: mission.id,
        title: mission.title,
        rewards: mission.rewards,
      });

      logger.info(`Mission created: ${mission.title}`);
    } catch (error) {
      logger.error(`Failed to create mission:`, error);
      throw error;
    }
  }

  async getMissionProgress(userId: string, missionId: string): Promise<any> {
    try {
      // Get mission details
      const mission = await db()('missions')
        .where('mission_id', missionId)
        .first();

      if (!mission) {
        throw new Error('Mission not found');
      }

      // Get user progress
      const progress = await db()('user_mission_progress')
        .where('user_id', userId)
        .where('mission_id', missionId)
        .first();

      const objectives = JSON.parse(mission.objectives);
      const currentProgress = progress ? JSON.parse(progress.progress) : {};

      // Calculate completion percentage
      let totalProgress = 0;
      const objectivesWithProgress = objectives.map((obj: any, index: number) => {
        const current = currentProgress[index] || 0;
        const percentage = Math.min(100, (current / obj.target) * 100);
        totalProgress += percentage;

        return {
          ...obj,
          progress: current,
          percentage: Math.round(percentage),
          completed: current >= obj.target,
        };
      });

      const overallProgress = Math.round(totalProgress / objectives.length);

      return {
        mission: {
          id: mission.mission_id,
          title: mission.title,
          description: mission.description,
          rewards: JSON.parse(mission.rewards),
          endTime: mission.end_time,
        },
        objectives: objectivesWithProgress,
        overallProgress,
        completed: overallProgress === 100,
        claimedReward: progress?.reward_claimed || false,
      };
    } catch (error) {
      logger.error(`Failed to get mission progress:`, error);
      throw error;
    }
  }

  async updateMissionProgress(userId: string, missionId: string, objectiveIndex: number, increment: number): Promise<void> {
    try {
      // Get current progress
      const progress = await db()('user_mission_progress')
        .where('user_id', userId)
        .where('mission_id', missionId)
        .first();

      let currentProgress = progress ? JSON.parse(progress.progress) : {};
      currentProgress[objectiveIndex] = (currentProgress[objectiveIndex] || 0) + increment;

      if (progress) {
        // Update existing progress
        await db()('user_mission_progress')
          .where('user_id', userId)
          .where('mission_id', missionId)
          .update({
            progress: JSON.stringify(currentProgress),
            updated_at: new Date(),
          });
      } else {
        // Create new progress entry
        await db()('user_mission_progress').insert({
          user_id: userId,
          mission_id: missionId,
          progress: JSON.stringify(currentProgress),
          created_at: new Date(),
          updated_at: new Date(),
        });
      }

      // Check if mission completed
      const missionProgress = await this.getMissionProgress(userId, missionId);
      if (missionProgress.completed && !missionProgress.claimedReward) {
        await this.completeMission(userId, missionId);
      }
    } catch (error) {
      logger.error(`Failed to update mission progress:`, error);
    }
  }

  private async completeMission(userId: string, missionId: string): Promise<void> {
    try {
      // Get mission rewards
      const mission = await db()('missions')
        .where('mission_id', missionId)
        .first();

      const rewards = JSON.parse(mission.rewards);

      // Award points
      if (rewards.points > 0) {
        await loyaltyService.earnPoints({
          userId,
          amount: rewards.points,
          type: require('./loyaltyService').TransactionType.EARN,
          source: require('./loyaltyService').PointSource.MISSION,
          sourceReferenceId: missionId,
          description: `Completed mission: ${mission.title}`,
        });
      }

      // Mark reward as claimed
      await db()('user_mission_progress')
        .where('user_id', userId)
        .where('mission_id', missionId)
        .update({
          reward_claimed: true,
          completed_at: new Date(),
        });

      // Publish event
      await publishEvent('gamification.mission.completed', {
        userId,
        missionId,
        missionTitle: mission.title,
        rewards,
      });

      logger.info(`User ${userId} completed mission: ${mission.title}`);
    } catch (error) {
      logger.error(`Failed to complete mission for user ${userId}:`, error);
    }
  }
}

export const gamificationService = new GamificationService();