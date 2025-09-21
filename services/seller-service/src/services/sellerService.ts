import { getDatabase } from '../config/database';
import { logger } from '../utils/logger';
import {
  SellerProfile,
  VerificationStatus,
  SellerTier,
  VerificationDocument
} from '../models/seller.model';
import { publishEvent } from '../utils/eventPublisher';

const db = getDatabase;

export async function createSeller(seller: Partial<SellerProfile>): Promise<SellerProfile> {
  try {
    const [newSeller] = await db()('seller_profiles')
      .insert(seller)
      .returning('*');

    // Publish seller registered event
    await publishEvent('seller.registered', {
      sellerId: newSeller.seller_id,
      tier: newSeller.tier,
      timestamp: new Date().toISOString(),
    });

    logger.info(`Seller created: ${newSeller.seller_id}`);
    return newSeller;
  } catch (error) {
    logger.error('Error creating seller:', error);
    throw new Error('Failed to create seller');
  }
}

export async function getSellerById(sellerId: string): Promise<SellerProfile | null> {
  try {
    const seller = await db()('seller_profiles')
      .where('seller_id', sellerId)
      .first();

    return seller || null;
  } catch (error) {
    logger.error(`Error fetching seller ${sellerId}:`, error);
    throw new Error('Failed to fetch seller');
  }
}

export async function updateSeller(
  sellerId: string,
  updates: Partial<SellerProfile>
): Promise<SellerProfile | null> {
  try {
    const [updatedSeller] = await db()('seller_profiles')
      .where('seller_id', sellerId)
      .update({
        ...updates,
        updated_at: new Date(),
      })
      .returning('*');

    if (updatedSeller && updates.verification_status === VerificationStatus.APPROVED) {
      await publishEvent('seller.verified', {
        sellerId: updatedSeller.seller_id,
        tier: updatedSeller.tier,
        timestamp: new Date().toISOString(),
      });
    }

    return updatedSeller || null;
  } catch (error) {
    logger.error(`Error updating seller ${sellerId}:`, error);
    throw new Error('Failed to update seller');
  }
}

export async function getSellerVerificationStatus(
  sellerId: string
): Promise<{ status: VerificationStatus; rejectionReason?: string } | null> {
  try {
    const seller = await db()('seller_profiles')
      .where('seller_id', sellerId)
      .select('verification_status')
      .first();

    if (!seller) return null;

    const lastRejection = await db()('verification_history')
      .where('seller_id', sellerId)
      .where('status', 'rejected')
      .orderBy('timestamp', 'desc')
      .first();

    return {
      status: seller.verification_status,
      rejectionReason: lastRejection?.provider_response?.reason,
    };
  } catch (error) {
    logger.error(`Error fetching verification status for ${sellerId}:`, error);
    throw new Error('Failed to fetch verification status');
  }
}

export async function getSellersByTier(tier: SellerTier): Promise<SellerProfile[]> {
  try {
    const sellers = await db()('seller_profiles')
      .where('tier', tier)
      .where('verification_status', VerificationStatus.APPROVED);

    return sellers;
  } catch (error) {
    logger.error(`Error fetching sellers by tier ${tier}:`, error);
    throw new Error('Failed to fetch sellers');
  }
}

export async function getPendingVerifications(): Promise<SellerProfile[]> {
  try {
    const sellers = await db()('seller_profiles')
      .where('verification_status', VerificationStatus.VERIFICATION_IN_PROGRESS)
      .orWhere('verification_status', VerificationStatus.PENDING);

    return sellers;
  } catch (error) {
    logger.error('Error fetching pending verifications:', error);
    throw new Error('Failed to fetch pending verifications');
  }
}

export async function getSellerDocuments(
  sellerId: string
): Promise<VerificationDocument[]> {
  try {
    const documents = await db()('verification_documents')
      .where('seller_id', sellerId)
      .orderBy('uploaded_at', 'desc');

    return documents;
  } catch (error) {
    logger.error(`Error fetching documents for seller ${sellerId}:`, error);
    throw new Error('Failed to fetch documents');
  }
}