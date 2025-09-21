import { Router } from 'express';
import * as sellerController from '../controllers/sellerController';
import { authMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { sellerValidationSchemas } from '../validators/sellerValidators';

const router = Router();

// Public routes (no auth required for registration)
router.post(
  '/register',
  validateRequest(sellerValidationSchemas.register),
  sellerController.registerSeller
);

// Protected routes
router.use(authMiddleware);

router.get('/:sellerId', sellerController.getSellerProfile);

router.patch(
  '/:sellerId',
  validateRequest(sellerValidationSchemas.update),
  sellerController.updateSellerProfile
);

router.get('/:sellerId/status', sellerController.getSellerStatus);

export default router;