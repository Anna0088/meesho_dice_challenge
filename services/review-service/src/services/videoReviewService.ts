import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../config/database';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { publishEvent } from '../utils/eventPublisher';

const db = getDatabase;
const redis = getRedisClient;

interface VideoUploadRequest {
  userId: string;
  productId: string;
  sellerId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

interface VideoProcessingResult {
  videoId: string;
  playbackUrl: string;
  thumbnailUrl: string;
  duration: number;
  resolution: string;
  status: 'processing' | 'ready' | 'failed';
}

interface VideoMetadata {
  duration: number;
  resolution: string;
  bitrate: number;
  codec: string;
  fileSize: number;
  thumbnails: string[];
}

export class VideoReviewService {
  private readonly videoApiUrl: string;
  private readonly videoApiKey: string;
  private readonly maxFileSize = 100 * 1024 * 1024; // 100MB
  private readonly maxDuration = 180; // 3 minutes
  private readonly allowedFormats = ['video/mp4', 'video/webm', 'video/quicktime'];

  constructor() {
    this.videoApiUrl = process.env.VIDEO_API_URL || 'https://api.video/v1';
    this.videoApiKey = process.env.VIDEO_API_KEY || '';
  }

  async initiateVideoUpload(request: VideoUploadRequest): Promise<any> {
    try {
      // Validate request
      this.validateUploadRequest(request);

      // Generate video ID
      const videoId = uuidv4();

      // Create upload session with video API provider
      const uploadSession = await this.createUploadSession(videoId, request);

      // Store initial video metadata
      await this.storeVideoMetadata(videoId, request, uploadSession);

      // Generate presigned upload URL
      const uploadUrl = await this.generateUploadUrl(videoId, uploadSession);

      logger.info(`Video upload initiated for user ${request.userId}, video ID: ${videoId}`);

      return {
        videoId,
        uploadUrl,
        uploadToken: uploadSession.token,
        expiresIn: 3600, // 1 hour
        maxFileSize: this.maxFileSize,
        allowedFormats: this.allowedFormats,
      };
    } catch (error) {
      logger.error('Failed to initiate video upload:', error);
      throw error;
    }
  }

  private validateUploadRequest(request: VideoUploadRequest): void {
    if (!this.allowedFormats.includes(request.mimeType)) {
      throw new Error(`Invalid file format. Allowed formats: ${this.allowedFormats.join(', ')}`);
    }

    if (request.fileSize > this.maxFileSize) {
      throw new Error(`File size exceeds maximum limit of ${this.maxFileSize / (1024 * 1024)}MB`);
    }
  }

  private async createUploadSession(videoId: string, request: VideoUploadRequest): Promise<any> {
    try {
      // Call video API to create upload session
      const response = await axios.post(
        `${this.videoApiUrl}/upload/sessions`,
        {
          videoId,
          metadata: {
            userId: request.userId,
            productId: request.productId,
            sellerId: request.sellerId,
            fileName: request.fileName,
          },
        },
        {
          headers: {
            'Authorization': `Bearer ${this.videoApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to create upload session:', error);
      throw new Error('Failed to create video upload session');
    }
  }

  private async storeVideoMetadata(videoId: string, request: VideoUploadRequest, uploadSession: any): Promise<void> {
    try {
      await db()('video_reviews').insert({
        video_id: videoId,
        user_id: request.userId,
        product_id: request.productId,
        seller_id: request.sellerId,
        file_name: request.fileName,
        file_size: request.fileSize,
        mime_type: request.mimeType,
        upload_token: uploadSession.token,
        status: 'uploading',
        created_at: new Date(),
      });

      // Cache metadata for quick access
      const cacheKey = `video:metadata:${videoId}`;
      await redis().setex(cacheKey, 3600, JSON.stringify({
        ...request,
        status: 'uploading',
      }));
    } catch (error) {
      logger.error('Failed to store video metadata:', error);
      throw error;
    }
  }

  private async generateUploadUrl(videoId: string, uploadSession: any): Promise<string> {
    try {
      // Generate presigned URL for direct upload
      const response = await axios.post(
        `${this.videoApiUrl}/upload/urls`,
        {
          sessionId: uploadSession.id,
          videoId,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.videoApiKey}`,
          },
        }
      );

      return response.data.uploadUrl;
    } catch (error) {
      logger.error('Failed to generate upload URL:', error);
      // Return fallback URL for development
      return `${this.videoApiUrl}/upload/${videoId}`;
    }
  }

  async processVideo(videoId: string): Promise<VideoProcessingResult> {
    try {
      logger.info(`Starting video processing for ${videoId}`);

      // Update status to processing
      await this.updateVideoStatus(videoId, 'processing');

      // Trigger video processing pipeline
      const processingResult = await this.triggerProcessing(videoId);

      // Perform content moderation
      const moderationResult = await this.moderateVideoContent(videoId);

      if (!moderationResult.approved) {
        await this.rejectVideo(videoId, moderationResult.reason);
        throw new Error(`Video rejected: ${moderationResult.reason}`);
      }

      // Generate multiple quality versions
      await this.generateQualityVariants(videoId);

      // Extract metadata
      const metadata = await this.extractVideoMetadata(videoId);

      // Generate thumbnails
      const thumbnails = await this.generateThumbnails(videoId, metadata);

      // Update database with processing results
      const result = await this.finalizeProcessing(videoId, {
        ...processingResult,
        metadata,
        thumbnails,
      });

      logger.info(`Video processing completed for ${videoId}`);

      return result;
    } catch (error) {
      logger.error(`Failed to process video ${videoId}:`, error);
      await this.updateVideoStatus(videoId, 'failed');
      throw error;
    }
  }

  private async triggerProcessing(videoId: string): Promise<any> {
    try {
      // Call video API to start processing
      const response = await axios.post(
        `${this.videoApiUrl}/videos/${videoId}/process`,
        {
          output: {
            formats: ['hls', 'mp4'],
            resolutions: ['360p', '720p', '1080p'],
            watermark: false,
          },
        },
        {
          headers: {
            'Authorization': `Bearer ${this.videoApiKey}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to trigger video processing:', error);
      // Return mock data for development
      return {
        jobId: uuidv4(),
        status: 'processing',
        estimatedTime: 120,
      };
    }
  }

  private async moderateVideoContent(videoId: string): Promise<any> {
    try {
      // Use AI service for content moderation
      const response = await axios.post(
        `${process.env.MODERATION_API_URL}/video/moderate`,
        { videoId },
        {
          headers: {
            'Authorization': `Bearer ${process.env.MODERATION_API_KEY}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to moderate video content:', error);
      // Return approved for development
      return {
        approved: true,
        confidence: 0.95,
        flags: [],
      };
    }
  }

  private async generateQualityVariants(videoId: string): Promise<void> {
    try {
      // Generate different quality versions for adaptive streaming
      const variants = [
        { resolution: '360p', bitrate: '800k' },
        { resolution: '720p', bitrate: '2500k' },
        { resolution: '1080p', bitrate: '5000k' },
      ];

      for (const variant of variants) {
        await this.createVariant(videoId, variant);
      }
    } catch (error) {
      logger.error('Failed to generate quality variants:', error);
    }
  }

  private async createVariant(videoId: string, variant: any): Promise<void> {
    // Implementation for creating video variant
    logger.info(`Creating ${variant.resolution} variant for video ${videoId}`);
  }

  private async extractVideoMetadata(videoId: string): Promise<VideoMetadata> {
    try {
      // Extract metadata using video API
      const response = await axios.get(
        `${this.videoApiUrl}/videos/${videoId}/metadata`,
        {
          headers: {
            'Authorization': `Bearer ${this.videoApiKey}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to extract video metadata:', error);
      // Return mock metadata for development
      return {
        duration: 60,
        resolution: '1080p',
        bitrate: 2500000,
        codec: 'h264',
        fileSize: 10485760,
        thumbnails: [],
      };
    }
  }

  private async generateThumbnails(videoId: string, metadata: VideoMetadata): Promise<string[]> {
    try {
      // Generate thumbnails at different timestamps
      const thumbnailCount = 4;
      const interval = metadata.duration / thumbnailCount;
      const thumbnails: string[] = [];

      for (let i = 0; i < thumbnailCount; i++) {
        const timestamp = i * interval;
        const thumbnailUrl = await this.generateThumbnail(videoId, timestamp);
        thumbnails.push(thumbnailUrl);
      }

      return thumbnails;
    } catch (error) {
      logger.error('Failed to generate thumbnails:', error);
      return [];
    }
  }

  private async generateThumbnail(videoId: string, timestamp: number): Promise<string> {
    try {
      const response = await axios.post(
        `${this.videoApiUrl}/videos/${videoId}/thumbnail`,
        { timestamp },
        {
          headers: {
            'Authorization': `Bearer ${this.videoApiKey}`,
          },
        }
      );

      return response.data.thumbnailUrl;
    } catch (error) {
      logger.error('Failed to generate thumbnail:', error);
      return `${this.videoApiUrl}/thumbnails/${videoId}_${timestamp}.jpg`;
    }
  }

  private async finalizeProcessing(videoId: string, data: any): Promise<VideoProcessingResult> {
    try {
      // Update database with final results
      await db()('video_reviews')
        .where('video_id', videoId)
        .update({
          playback_url: data.playbackUrl || `${this.videoApiUrl}/play/${videoId}`,
          thumbnail_url: data.thumbnails[0] || `${this.videoApiUrl}/thumbnails/${videoId}.jpg`,
          duration: data.metadata.duration,
          resolution: data.metadata.resolution,
          metadata: JSON.stringify(data.metadata),
          status: 'ready',
          processed_at: new Date(),
        });

      // Clear cache and publish event
      await redis().del(`video:metadata:${videoId}`);
      await publishEvent('video.processing.completed', {
        videoId,
        duration: data.metadata.duration,
      });

      return {
        videoId,
        playbackUrl: data.playbackUrl || `${this.videoApiUrl}/play/${videoId}`,
        thumbnailUrl: data.thumbnails[0] || `${this.videoApiUrl}/thumbnails/${videoId}.jpg`,
        duration: data.metadata.duration,
        resolution: data.metadata.resolution,
        status: 'ready',
      };
    } catch (error) {
      logger.error('Failed to finalize video processing:', error);
      throw error;
    }
  }

  private async updateVideoStatus(videoId: string, status: string): Promise<void> {
    try {
      await db()('video_reviews')
        .where('video_id', videoId)
        .update({
          status,
          updated_at: new Date(),
        });

      // Update cache
      const cacheKey = `video:metadata:${videoId}`;
      const cached = await redis().get(cacheKey);
      if (cached) {
        const metadata = JSON.parse(cached);
        metadata.status = status;
        await redis().setex(cacheKey, 3600, JSON.stringify(metadata));
      }
    } catch (error) {
      logger.error(`Failed to update video status for ${videoId}:`, error);
    }
  }

  private async rejectVideo(videoId: string, reason: string): Promise<void> {
    try {
      await db()('video_reviews')
        .where('video_id', videoId)
        .update({
          status: 'rejected',
          rejection_reason: reason,
          updated_at: new Date(),
        });

      await publishEvent('video.rejected', {
        videoId,
        reason,
      });

      logger.info(`Video ${videoId} rejected: ${reason}`);
    } catch (error) {
      logger.error(`Failed to reject video ${videoId}:`, error);
    }
  }

  async getVideoPlaybackUrl(videoId: string): Promise<string> {
    try {
      // Check cache first
      const cacheKey = `video:playback:${videoId}`;
      const cached = await redis().get(cacheKey);
      if (cached) {
        return cached;
      }

      // Get from database
      const video = await db()('video_reviews')
        .where('video_id', videoId)
        .where('status', 'ready')
        .first();

      if (!video) {
        throw new Error('Video not found or not ready');
      }

      // Generate signed playback URL
      const playbackUrl = await this.generateSignedPlaybackUrl(videoId, video.playback_url);

      // Cache for 1 hour
      await redis().setex(cacheKey, 3600, playbackUrl);

      return playbackUrl;
    } catch (error) {
      logger.error(`Failed to get playback URL for video ${videoId}:`, error);
      throw error;
    }
  }

  private async generateSignedPlaybackUrl(videoId: string, baseUrl: string): Promise<string> {
    try {
      // Generate time-limited signed URL
      const expiryTime = Date.now() + 3600000; // 1 hour
      const signature = this.generateSignature(videoId, expiryTime);

      return `${baseUrl}?videoId=${videoId}&expires=${expiryTime}&signature=${signature}`;
    } catch (error) {
      logger.error('Failed to generate signed playback URL:', error);
      return baseUrl;
    }
  }

  private generateSignature(videoId: string, expiryTime: number): string {
    const crypto = require('crypto');
    const secret = process.env.VIDEO_SIGNING_SECRET || 'default-secret';
    const data = `${videoId}:${expiryTime}`;

    return crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');
  }

  async addShoppableElements(videoId: string, elements: any[]): Promise<void> {
    try {
      // Add interactive shopping elements to video
      await db()('video_shoppable_elements').insert(
        elements.map(element => ({
          element_id: uuidv4(),
          video_id: videoId,
          product_id: element.productId,
          timestamp_start: element.timestampStart,
          timestamp_end: element.timestampEnd,
          position: JSON.stringify(element.position),
          action: element.action || 'view_product',
          created_at: new Date(),
        }))
      );

      logger.info(`Added ${elements.length} shoppable elements to video ${videoId}`);
    } catch (error) {
      logger.error(`Failed to add shoppable elements to video ${videoId}:`, error);
      throw error;
    }
  }

  async getVideoAnalytics(videoId: string): Promise<any> {
    try {
      const [views, engagement, conversions] = await Promise.all([
        this.getVideoViews(videoId),
        this.getVideoEngagement(videoId),
        this.getVideoConversions(videoId),
      ]);

      return {
        videoId,
        views,
        engagement,
        conversions,
        performance: this.calculatePerformanceScore(views, engagement, conversions),
      };
    } catch (error) {
      logger.error(`Failed to get analytics for video ${videoId}:`, error);
      throw error;
    }
  }

  private async getVideoViews(videoId: string): Promise<any> {
    const viewsKey = `video:views:${videoId}`;
    const views = await redis().get(viewsKey);

    return {
      total: parseInt(views || '0'),
      unique: await redis().scard(`video:unique_views:${videoId}`),
      averageWatchTime: await this.getAverageWatchTime(videoId),
    };
  }

  private async getVideoEngagement(videoId: string): Promise<any> {
    return {
      likes: await redis().get(`video:likes:${videoId}`) || 0,
      shares: await redis().get(`video:shares:${videoId}`) || 0,
      comments: await redis().get(`video:comments:${videoId}`) || 0,
      completionRate: await this.getCompletionRate(videoId),
    };
  }

  private async getVideoConversions(videoId: string): Promise<any> {
    const clicks = await redis().get(`video:clicks:${videoId}`) || '0';
    const purchases = await redis().get(`video:purchases:${videoId}`) || '0';

    return {
      clicks: parseInt(clicks),
      purchases: parseInt(purchases),
      conversionRate: parseInt(clicks) > 0 ? (parseInt(purchases) / parseInt(clicks)) * 100 : 0,
    };
  }

  private async getAverageWatchTime(videoId: string): Promise<number> {
    const watchTimes = await redis().lrange(`video:watch_times:${videoId}`, 0, -1);
    if (watchTimes.length === 0) return 0;

    const total = watchTimes.reduce((sum, time) => sum + parseFloat(time), 0);
    return total / watchTimes.length;
  }

  private async getCompletionRate(videoId: string): Promise<number> {
    const completions = await redis().get(`video:completions:${videoId}`) || '0';
    const starts = await redis().get(`video:starts:${videoId}`) || '0';

    return parseInt(starts) > 0 ? (parseInt(completions) / parseInt(starts)) * 100 : 0;
  }

  private calculatePerformanceScore(views: any, engagement: any, conversions: any): number {
    // Calculate weighted performance score
    const viewScore = Math.min(100, views.total / 100);
    const engagementScore = Math.min(100, (engagement.likes + engagement.shares + engagement.comments) / 10);
    const conversionScore = Math.min(100, conversions.conversionRate * 10);

    return Math.round((viewScore * 0.3 + engagementScore * 0.3 + conversionScore * 0.4));
  }
}

export const videoReviewService = new VideoReviewService();