import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import * as sellerService from '../services/sellerService';
import { SellerTier, VerificationStatus } from '../models/seller.model';

export async function registerSeller(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, phone, business_name, seller_tier } = req.body;

    // Validate input
    if (!email || !phone || !seller_tier) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Create seller
    const sellerId = uuidv4();
    const seller = await sellerService.createSeller({
      seller_id: sellerId,
      email,
      phone,
      business_name,
      tier: seller_tier as SellerTier,
      verification_status: VerificationStatus.PENDING,
      bank_account_verified: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    logger.info(`New seller registered: ${sellerId}`);

    res.status(201).json({
      sellerId: seller.seller_id,
      status: seller.verification_status,
      message: 'Seller registration initiated successfully',
    });
  } catch (error) {
    next(error);
  }
}

export async function getSellerProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { sellerId } = req.params;

    const seller = await sellerService.getSellerById(sellerId);

    if (!seller) {
      res.status(404).json({ error: 'Seller not found' });
      return;
    }

    res.json(seller);
  } catch (error) {
    next(error);
  }
}

export async function updateSellerProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { sellerId } = req.params;
    const updates = req.body;

    const updatedSeller = await sellerService.updateSeller(sellerId, updates);

    if (!updatedSeller) {
      res.status(404).json({ error: 'Seller not found' });
      return;
    }

    res.json(updatedSeller);
  } catch (error) {
    next(error);
  }
}

export async function getSellerStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { sellerId } = req.params;

    const status = await sellerService.getSellerVerificationStatus(sellerId);

    if (!status) {
      res.status(404).json({ error: 'Seller not found' });
      return;
    }

    res.json(status);
  } catch (error) {
    next(error);
  }
}