import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { documentService } from '../services/documentService';
import { verificationService } from '../services/verificationService';
import { logger } from '../utils/logger';

const router = Router();

// All verification routes require authentication
router.use(authMiddleware);

// Upload document
router.post(
  '/:sellerId/documents',
  documentService.getMulterMiddleware(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sellerId } = req.params;
      const { document_type } = req.body;
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      if (!document_type) {
        res.status(400).json({ error: 'Document type is required' });
        return;
      }

      const document = await documentService.uploadDocument(
        sellerId,
        document_type,
        file
      );

      res.status(201).json({
        documentId: document.document_id,
        status: 'uploaded',
        message: 'Document uploaded successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get presigned upload URL
router.post(
  '/:sellerId/documents/presigned-url',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sellerId } = req.params;
      const { document_type, file_name } = req.body;

      if (!document_type || !file_name) {
        res.status(400).json({ error: 'Document type and file name are required' });
        return;
      }

      const { uploadUrl, documentId } = await documentService.getPresignedUploadUrl(
        sellerId,
        document_type,
        file_name
      );

      res.json({
        uploadUrl,
        documentId,
        expiresIn: 300, // 5 minutes
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get document URL
router.get(
  '/:sellerId/documents/:documentId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sellerId, documentId } = req.params;

      const url = await documentService.getDocumentUrl(sellerId, documentId);

      res.json({ url });
    } catch (error) {
      next(error);
    }
  }
);

// Trigger verification
router.post(
  '/:sellerId/verify',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sellerId } = req.params;

      // Start verification process asynchronously
      verificationService.verifySellerDocuments(sellerId).catch((error) => {
        logger.error(`Verification failed for seller ${sellerId}:`, error);
      });

      res.json({
        verification_job_id: `verify_${sellerId}_${Date.now()}`,
        status: 'verification_in_progress',
        message: 'Verification process started',
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get verification history
router.get(
  '/:sellerId/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sellerId } = req.params;

      const history = await require('../config/database')
        .getDatabase()('verification_history')
        .where('seller_id', sellerId)
        .orderBy('timestamp', 'desc')
        .limit(50);

      res.json(history);
    } catch (error) {
      next(error);
    }
  }
);

export default router;