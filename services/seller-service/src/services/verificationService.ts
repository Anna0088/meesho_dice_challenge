import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../config/database';
import { logger } from '../utils/logger';
import { getRedisClient } from '../config/redis';
import {
  SellerProfile,
  SellerTier,
  VerificationStatus,
  VerificationDocument,
} from '../models/seller.model';
import { publishEvent } from '../utils/eventPublisher';
import * as sellerService from './sellerService';

const db = getDatabase;
const redis = getRedisClient;

interface VerificationResult {
  success: boolean;
  score: number;
  details: any;
  provider: string;
}

interface KYCResponse {
  verified: boolean;
  confidence: number;
  matchedFields: string[];
  flaggedIssues: string[];
}

export class VerificationService {
  private kycProviderUrl: string;
  private kycApiKey: string;
  private amlProviderUrl: string;
  private amlApiKey: string;

  constructor() {
    this.kycProviderUrl = process.env.KYC_PROVIDER_URL || '';
    this.kycApiKey = process.env.KYC_PROVIDER_API_KEY || '';
    this.amlProviderUrl = process.env.AML_PROVIDER_URL || '';
    this.amlApiKey = process.env.AML_PROVIDER_API_KEY || '';
  }

  async verifySellerDocuments(sellerId: string): Promise<void> {
    try {
      const seller = await sellerService.getSellerById(sellerId);
      if (!seller) {
        throw new Error('Seller not found');
      }

      // Update status to verification in progress
      await sellerService.updateSeller(sellerId, {
        verification_status: VerificationStatus.VERIFICATION_IN_PROGRESS,
      });

      const documents = await sellerService.getSellerDocuments(sellerId);

      // Perform verification based on seller tier
      let verificationResult: boolean = false;

      switch (seller.tier) {
        case SellerTier.INDIVIDUAL:
          verificationResult = await this.verifyIndividualSeller(sellerId, documents);
          break;
        case SellerTier.SMALL_BUSINESS:
          verificationResult = await this.verifySmallBusiness(sellerId, documents);
          break;
        case SellerTier.VERIFIED_BRAND:
          verificationResult = await this.verifyBrand(sellerId, documents);
          break;
      }

      // Update seller status based on verification result
      const newStatus = verificationResult
        ? VerificationStatus.APPROVED
        : VerificationStatus.REJECTED;

      await sellerService.updateSeller(sellerId, {
        verification_status: newStatus,
      });

      // Publish verification completed event
      await publishEvent('seller.verification.completed', {
        sellerId,
        status: newStatus,
        tier: seller.tier,
        timestamp: new Date().toISOString(),
      });

      logger.info(`Verification completed for seller ${sellerId}: ${newStatus}`);
    } catch (error) {
      logger.error(`Verification failed for seller ${sellerId}:`, error);
      await sellerService.updateSeller(sellerId, {
        verification_status: VerificationStatus.INFO_REQUIRED,
      });
      throw error;
    }
  }

  private async verifyIndividualSeller(
    sellerId: string,
    documents: VerificationDocument[]
  ): Promise<boolean> {
    const requiredDocs = ['national_id_front', 'national_id_back', 'bank_statement'];

    // Check if all required documents are present
    const providedDocTypes = documents.map(doc => doc.document_type);
    const hasAllDocs = requiredDocs.every(docType => providedDocTypes.includes(docType));

    if (!hasAllDocs) {
      await this.recordVerificationStep(sellerId, 'document_check', 'failed', {
        reason: 'Missing required documents',
        missing: requiredDocs.filter(d => !providedDocTypes.includes(d)),
      });
      return false;
    }

    // Verify identity documents
    const idVerification = await this.verifyIdentityDocuments(sellerId, documents);
    if (!idVerification.success) {
      return false;
    }

    // Verify liveness check
    const livenessCheck = await this.performLivenessCheck(sellerId);
    if (!livenessCheck.success) {
      return false;
    }

    // Verify bank account
    const bankVerification = await this.verifyBankAccount(sellerId, documents);
    if (!bankVerification.success) {
      return false;
    }

    return true;
  }

  private async verifySmallBusiness(
    sellerId: string,
    documents: VerificationDocument[]
  ): Promise<boolean> {
    // First verify as individual
    const individualVerification = await this.verifyIndividualSeller(sellerId, documents);
    if (!individualVerification) {
      return false;
    }

    // Additional business verification
    const businessDocs = documents.filter(d =>
      ['business_registration', 'gstin_certificate', 'business_pan'].includes(d.document_type)
    );

    if (businessDocs.length === 0) {
      await this.recordVerificationStep(sellerId, 'business_verification', 'failed', {
        reason: 'No business documents provided',
      });
      return false;
    }

    // Verify business registration
    const businessVerification = await this.verifyBusinessRegistration(sellerId, businessDocs);
    if (!businessVerification.success) {
      return false;
    }

    // Verify GST registration
    const gstVerification = await this.verifyGSTIN(sellerId);
    if (!gstVerification.success) {
      return false;
    }

    return true;
  }

  private async verifyBrand(
    sellerId: string,
    documents: VerificationDocument[]
  ): Promise<boolean> {
    // First verify as small business
    const businessVerification = await this.verifySmallBusiness(sellerId, documents);
    if (!businessVerification) {
      return false;
    }

    // AML/Sanctions screening
    const amlScreening = await this.performAMLScreening(sellerId);
    if (!amlScreening.success) {
      return false;
    }

    // UBO verification
    const uboVerification = await this.verifyUltimateBeneficialOwners(sellerId, documents);
    if (!uboVerification.success) {
      return false;
    }

    return true;
  }

  private async verifyIdentityDocuments(
    sellerId: string,
    documents: VerificationDocument[]
  ): Promise<VerificationResult> {
    try {
      const idDocs = documents.filter(d =>
        d.document_type.includes('national_id') || d.document_type.includes('passport')
      );

      // Simulate KYC API call (replace with actual API integration)
      const kycResponse = await this.callKYCProvider({
        documents: idDocs.map(d => d.storage_url),
        documentTypes: idDocs.map(d => d.document_type),
      });

      await this.recordVerificationStep(sellerId, 'identity_verification',
        kycResponse.verified ? 'passed' : 'failed', kycResponse);

      return {
        success: kycResponse.verified,
        score: kycResponse.confidence,
        details: kycResponse,
        provider: 'kyc_provider',
      };
    } catch (error) {
      logger.error(`Identity verification failed for ${sellerId}:`, error);
      return {
        success: false,
        score: 0,
        details: { error: error.message },
        provider: 'kyc_provider',
      };
    }
  }

  private async performLivenessCheck(sellerId: string): Promise<VerificationResult> {
    try {
      // Simulate liveness check API call
      const livenessScore = Math.random() * 100; // Replace with actual API call
      const success = livenessScore > 70;

      await this.recordVerificationStep(sellerId, 'liveness_check',
        success ? 'passed' : 'failed', { score: livenessScore });

      return {
        success,
        score: livenessScore,
        details: { livenessScore },
        provider: 'biometric_provider',
      };
    } catch (error) {
      logger.error(`Liveness check failed for ${sellerId}:`, error);
      return {
        success: false,
        score: 0,
        details: { error: error.message },
        provider: 'biometric_provider',
      };
    }
  }

  private async verifyBankAccount(
    sellerId: string,
    documents: VerificationDocument[]
  ): Promise<VerificationResult> {
    try {
      const bankDoc = documents.find(d =>
        d.document_type === 'bank_statement' || d.document_type === 'cancelled_cheque'
      );

      if (!bankDoc) {
        return {
          success: false,
          score: 0,
          details: { error: 'No bank document provided' },
          provider: 'bank_verification',
        };
      }

      // Simulate bank verification (replace with actual API)
      const verified = true; // Placeholder

      await this.recordVerificationStep(sellerId, 'bank_verification',
        verified ? 'passed' : 'failed', { documentId: bankDoc.document_id });

      // Update seller profile
      if (verified) {
        await db()('seller_profiles')
          .where('seller_id', sellerId)
          .update({ bank_account_verified: true });
      }

      return {
        success: verified,
        score: verified ? 100 : 0,
        details: { verified },
        provider: 'bank_verification',
      };
    } catch (error) {
      logger.error(`Bank verification failed for ${sellerId}:`, error);
      return {
        success: false,
        score: 0,
        details: { error: error.message },
        provider: 'bank_verification',
      };
    }
  }

  private async verifyBusinessRegistration(
    sellerId: string,
    documents: VerificationDocument[]
  ): Promise<VerificationResult> {
    try {
      // Simulate business registration verification
      const registrationDoc = documents.find(d => d.document_type === 'business_registration');

      if (!registrationDoc) {
        return {
          success: false,
          score: 0,
          details: { error: 'No business registration document' },
          provider: 'business_registry',
        };
      }

      // Call government API to verify business registration
      const verified = true; // Placeholder for actual API call

      await this.recordVerificationStep(sellerId, 'business_registration',
        verified ? 'passed' : 'failed', { documentId: registrationDoc.document_id });

      return {
        success: verified,
        score: verified ? 100 : 0,
        details: { verified },
        provider: 'business_registry',
      };
    } catch (error) {
      logger.error(`Business registration verification failed for ${sellerId}:`, error);
      return {
        success: false,
        score: 0,
        details: { error: error.message },
        provider: 'business_registry',
      };
    }
  }

  private async verifyGSTIN(sellerId: string): Promise<VerificationResult> {
    try {
      const seller = await sellerService.getSellerById(sellerId);

      if (!seller?.gstin) {
        return {
          success: false,
          score: 0,
          details: { error: 'No GSTIN provided' },
          provider: 'gst_portal',
        };
      }

      // Simulate GST verification API call
      const verified = true; // Placeholder for actual API call

      await this.recordVerificationStep(sellerId, 'gstin_verification',
        verified ? 'passed' : 'failed', { gstin: seller.gstin });

      return {
        success: verified,
        score: verified ? 100 : 0,
        details: { verified, gstin: seller.gstin },
        provider: 'gst_portal',
      };
    } catch (error) {
      logger.error(`GSTIN verification failed for ${sellerId}:`, error);
      return {
        success: false,
        score: 0,
        details: { error: error.message },
        provider: 'gst_portal',
      };
    }
  }

  private async performAMLScreening(sellerId: string): Promise<VerificationResult> {
    try {
      const seller = await sellerService.getSellerById(sellerId);

      // Simulate AML screening API call
      const screeningResult = {
        clear: true,
        matchedLists: [],
        riskScore: 10, // Low risk
      };

      await this.recordVerificationStep(sellerId, 'aml_screening',
        screeningResult.clear ? 'passed' : 'failed', screeningResult);

      return {
        success: screeningResult.clear,
        score: 100 - screeningResult.riskScore,
        details: screeningResult,
        provider: 'aml_provider',
      };
    } catch (error) {
      logger.error(`AML screening failed for ${sellerId}:`, error);
      return {
        success: false,
        score: 0,
        details: { error: error.message },
        provider: 'aml_provider',
      };
    }
  }

  private async verifyUltimateBeneficialOwners(
    sellerId: string,
    documents: VerificationDocument[]
  ): Promise<VerificationResult> {
    try {
      const uboDocs = documents.filter(d => d.document_type.includes('ubo'));

      if (uboDocs.length === 0) {
        return {
          success: false,
          score: 0,
          details: { error: 'No UBO documents provided' },
          provider: 'ubo_verification',
        };
      }

      // Simulate UBO verification
      const verified = true; // Placeholder

      await this.recordVerificationStep(sellerId, 'ubo_verification',
        verified ? 'passed' : 'failed', { documentCount: uboDocs.length });

      return {
        success: verified,
        score: verified ? 100 : 0,
        details: { verified, uboCount: uboDocs.length },
        provider: 'ubo_verification',
      };
    } catch (error) {
      logger.error(`UBO verification failed for ${sellerId}:`, error);
      return {
        success: false,
        score: 0,
        details: { error: error.message },
        provider: 'ubo_verification',
      };
    }
  }

  private async callKYCProvider(data: any): Promise<KYCResponse> {
    // Simulate KYC API call - replace with actual implementation
    try {
      if (this.kycProviderUrl && this.kycApiKey) {
        const response = await axios.post(this.kycProviderUrl, data, {
          headers: {
            'Authorization': `Bearer ${this.kycApiKey}`,
            'Content-Type': 'application/json',
          },
        });
        return response.data;
      }

      // Mock response for development
      return {
        verified: Math.random() > 0.2, // 80% success rate for testing
        confidence: Math.random() * 100,
        matchedFields: ['name', 'dob', 'address'],
        flaggedIssues: [],
      };
    } catch (error) {
      logger.error('KYC provider API call failed:', error);
      throw error;
    }
  }

  private async recordVerificationStep(
    sellerId: string,
    step: string,
    status: string,
    details: any
  ): Promise<void> {
    try {
      await db()('verification_history').insert({
        history_id: uuidv4(),
        seller_id: sellerId,
        verification_step: step,
        status,
        provider_response: JSON.stringify(details),
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error(`Failed to record verification step for ${sellerId}:`, error);
    }
  }
}

export const verificationService = new VerificationService();