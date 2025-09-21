import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import * as sellerService from '../services/sellerService';
import { SellerProfile, SellerTier, VerificationStatus } from '../models/seller.model';
import { getDatabase } from '../config/database';

// Mock database
jest.mock('../config/database');
jest.mock('../utils/eventPublisher');

describe('SellerService', () => {
  let testSellerId: string;

  beforeAll(() => {
    // Setup mock database
    const mockDb = jest.fn(() => ({
      insert: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      first: jest.fn(),
      returning: jest.fn(() => Promise.resolve([{
        seller_id: 'test-seller-123',
        email: 'test@example.com',
        phone: '+919876543210',
        tier: SellerTier.INDIVIDUAL,
        verification_status: VerificationStatus.PENDING,
      }])),
    }));

    (getDatabase as jest.Mock).mockReturnValue(mockDb);
  });

  describe('createSeller', () => {
    it('should create a new seller successfully', async () => {
      const sellerData: Partial<SellerProfile> = {
        email: 'test@example.com',
        phone: '+919876543210',
        business_name: 'Test Business',
        tier: SellerTier.INDIVIDUAL,
        verification_status: VerificationStatus.PENDING,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const result = await sellerService.createSeller(sellerData);

      expect(result).toBeDefined();
      expect(result.seller_id).toBe('test-seller-123');
      expect(result.email).toBe(sellerData.email);
      expect(result.tier).toBe(sellerData.tier);
    });

    it('should throw error for duplicate email', async () => {
      const mockDb = jest.fn(() => ({
        insert: jest.fn().mockRejectedValue(new Error('Duplicate key violation')),
      }));

      (getDatabase as jest.Mock).mockReturnValueOnce(mockDb);

      const sellerData: Partial<SellerProfile> = {
        email: 'duplicate@example.com',
        phone: '+919876543211',
        tier: SellerTier.INDIVIDUAL,
      };

      await expect(sellerService.createSeller(sellerData)).rejects.toThrow();
    });
  });

  describe('getSellerById', () => {
    it('should return seller when found', async () => {
      const mockSeller = {
        seller_id: 'test-seller-123',
        email: 'test@example.com',
        verification_status: VerificationStatus.APPROVED,
      };

      const mockDb = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        first: jest.fn(() => Promise.resolve(mockSeller)),
      }));

      (getDatabase as jest.Mock).mockReturnValueOnce(mockDb);

      const result = await sellerService.getSellerById('test-seller-123');

      expect(result).toBeDefined();
      expect(result?.seller_id).toBe('test-seller-123');
    });

    it('should return null when seller not found', async () => {
      const mockDb = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        first: jest.fn(() => Promise.resolve(null)),
      }));

      (getDatabase as jest.Mock).mockReturnValueOnce(mockDb);

      const result = await sellerService.getSellerById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('updateSeller', () => {
    it('should update seller successfully', async () => {
      const updates = {
        verification_status: VerificationStatus.APPROVED,
        bank_account_verified: true,
      };

      const mockDb = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        returning: jest.fn(() => Promise.resolve([{
          seller_id: 'test-seller-123',
          ...updates,
        }])),
      }));

      (getDatabase as jest.Mock).mockReturnValueOnce(mockDb);

      const result = await sellerService.updateSeller('test-seller-123', updates);

      expect(result).toBeDefined();
      expect(result?.verification_status).toBe(VerificationStatus.APPROVED);
      expect(result?.bank_account_verified).toBe(true);
    });
  });

  describe('getSellersByTier', () => {
    it('should return sellers of specified tier', async () => {
      const mockSellers = [
        { seller_id: '1', tier: SellerTier.INDIVIDUAL },
        { seller_id: '2', tier: SellerTier.INDIVIDUAL },
      ];

      const mockDb = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        select: jest.fn(() => Promise.resolve(mockSellers)),
      }));

      (getDatabase as jest.Mock).mockReturnValueOnce(mockDb);

      const result = await sellerService.getSellersByTier(SellerTier.INDIVIDUAL);

      expect(result).toHaveLength(2);
      expect(result[0].tier).toBe(SellerTier.INDIVIDUAL);
    });
  });
});