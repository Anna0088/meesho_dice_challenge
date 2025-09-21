import AWS from 'aws-sdk';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import crypto from 'crypto';
import { getDatabase } from '../config/database';
import { logger } from '../utils/logger';
import { VerificationDocument, VerificationStatus } from '../models/seller.model';
import { publishEvent } from '../utils/eventPublisher';

const db = getDatabase;

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'meesho-documents';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
];

export class DocumentService {
  private multerUpload: multer.Multer;

  constructor() {
    // Configure multer for temporary storage
    this.multerUpload = multer({
      limits: {
        fileSize: MAX_FILE_SIZE,
      },
      fileFilter: (req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF are allowed.'));
        }
      },
      storage: multer.memoryStorage(),
    });
  }

  getMulterMiddleware() {
    return this.multerUpload.single('document');
  }

  async uploadDocument(
    sellerId: string,
    documentType: string,
    file: Express.Multer.File
  ): Promise<VerificationDocument> {
    try {
      // Generate unique file key
      const fileExtension = path.extname(file.originalname);
      const documentId = uuidv4();
      const fileKey = `sellers/${sellerId}/${documentType}/${documentId}${fileExtension}`;

      // Calculate file hash for integrity
      const fileHash = crypto
        .createHash('sha256')
        .update(file.buffer)
        .digest('hex');

      // Upload to S3
      const uploadParams: AWS.S3.PutObjectRequest = {
        Bucket: BUCKET_NAME,
        Key: fileKey,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          sellerId,
          documentType,
          documentId,
          fileHash,
          originalName: file.originalname,
        },
        ServerSideEncryption: 'AES256',
        StorageClass: 'STANDARD_IA',
      };

      const uploadResult = await s3.upload(uploadParams).promise();
      logger.info(`Document uploaded to S3: ${uploadResult.Location}`);

      // Save document metadata to database
      const document: Partial<VerificationDocument> = {
        document_id: documentId,
        seller_id: sellerId,
        document_type: documentType,
        storage_url: uploadResult.Location,
        verification_status: VerificationStatus.PENDING,
        uploaded_at: new Date(),
      };

      const [savedDocument] = await db()('verification_documents')
        .insert(document)
        .returning('*');

      // Publish document uploaded event
      await publishEvent('seller.document.uploaded', {
        sellerId,
        documentId,
        documentType,
        timestamp: new Date().toISOString(),
      });

      logger.info(`Document metadata saved: ${documentId}`);
      return savedDocument;
    } catch (error) {
      logger.error('Document upload failed:', error);
      throw new Error('Failed to upload document');
    }
  }

  async getDocumentUrl(
    sellerId: string,
    documentId: string,
    expiryMinutes: number = 60
  ): Promise<string> {
    try {
      // Fetch document from database
      const document = await db()('verification_documents')
        .where('document_id', documentId)
        .where('seller_id', sellerId)
        .first();

      if (!document) {
        throw new Error('Document not found');
      }

      // Extract S3 key from storage URL
      const url = new URL(document.storage_url);
      const key = url.pathname.substring(1);

      // Generate presigned URL
      const presignedUrl = await s3.getSignedUrlPromise('getObject', {
        Bucket: BUCKET_NAME,
        Key: key,
        Expires: expiryMinutes * 60,
      });

      return presignedUrl;
    } catch (error) {
      logger.error('Failed to generate document URL:', error);
      throw new Error('Failed to generate document URL');
    }
  }

  async getPresignedUploadUrl(
    sellerId: string,
    documentType: string,
    fileName: string
  ): Promise<{ uploadUrl: string; documentId: string }> {
    try {
      const fileExtension = path.extname(fileName);
      const documentId = uuidv4();
      const fileKey = `sellers/${sellerId}/${documentType}/${documentId}${fileExtension}`;

      const params = {
        Bucket: BUCKET_NAME,
        Key: fileKey,
        Expires: 300, // 5 minutes
        ContentType: this.getMimeType(fileExtension),
        Metadata: {
          sellerId,
          documentType,
          documentId,
        },
      };

      const uploadUrl = await s3.getSignedUrlPromise('putObject', params);

      return {
        uploadUrl,
        documentId,
      };
    } catch (error) {
      logger.error('Failed to generate presigned upload URL:', error);
      throw new Error('Failed to generate upload URL');
    }
  }

  async deleteDocument(sellerId: string, documentId: string): Promise<void> {
    try {
      // Fetch document from database
      const document = await db()('verification_documents')
        .where('document_id', documentId)
        .where('seller_id', sellerId)
        .first();

      if (!document) {
        throw new Error('Document not found');
      }

      // Extract S3 key from storage URL
      const url = new URL(document.storage_url);
      const key = url.pathname.substring(1);

      // Delete from S3
      await s3.deleteObject({
        Bucket: BUCKET_NAME,
        Key: key,
      }).promise();

      // Delete from database
      await db()('verification_documents')
        .where('document_id', documentId)
        .delete();

      logger.info(`Document deleted: ${documentId}`);
    } catch (error) {
      logger.error('Failed to delete document:', error);
      throw new Error('Failed to delete document');
    }
  }

  async updateDocumentStatus(
    documentId: string,
    status: VerificationStatus,
    rejectionReason?: string
  ): Promise<void> {
    try {
      const updateData: any = {
        verification_status: status,
        verified_at: status === VerificationStatus.APPROVED ? new Date() : null,
      };

      if (rejectionReason) {
        updateData.rejection_reason = rejectionReason;
      }

      await db()('verification_documents')
        .where('document_id', documentId)
        .update(updateData);

      logger.info(`Document ${documentId} status updated to ${status}`);
    } catch (error) {
      logger.error('Failed to update document status:', error);
      throw new Error('Failed to update document status');
    }
  }

  async validateDocumentIntegrity(
    documentId: string,
    expectedHash: string
  ): Promise<boolean> {
    try {
      const document = await db()('verification_documents')
        .where('document_id', documentId)
        .first();

      if (!document) {
        return false;
      }

      // Extract S3 key from storage URL
      const url = new URL(document.storage_url);
      const key = url.pathname.substring(1);

      // Download file from S3
      const s3Object = await s3.getObject({
        Bucket: BUCKET_NAME,
        Key: key,
      }).promise();

      // Calculate hash
      const actualHash = crypto
        .createHash('sha256')
        .update(s3Object.Body as Buffer)
        .digest('hex');

      return actualHash === expectedHash;
    } catch (error) {
      logger.error('Document integrity validation failed:', error);
      return false;
    }
  }

  private getMimeType(extension: string): string {
    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
    };

    return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
  }
}

export const documentService = new DocumentService();