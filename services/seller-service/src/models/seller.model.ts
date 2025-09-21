export enum SellerTier {
  INDIVIDUAL = 'individual',
  SMALL_BUSINESS = 'small_business',
  VERIFIED_BRAND = 'verified_brand'
}

export enum VerificationStatus {
  PENDING = 'pending',
  INFO_REQUIRED = 'info_required',
  VERIFICATION_IN_PROGRESS = 'verification_in_progress',
  APPROVED = 'approved',
  REJECTED = 'rejected'
}

export interface SellerProfile {
  seller_id: string;
  email: string;
  phone: string;
  business_name?: string;
  tier: SellerTier;
  verification_status: VerificationStatus;
  gstin?: string;
  pan?: string;
  bank_account_verified: boolean;
  sqs_score?: number;
  created_at: Date;
  updated_at: Date;
}

export interface VerificationDocument {
  document_id: string;
  seller_id: string;
  document_type: string;
  storage_url: string;
  verification_status: VerificationStatus;
  uploaded_at: Date;
  verified_at?: Date;
  rejection_reason?: string;
}

export interface VerificationHistory {
  history_id: string;
  seller_id: string;
  verification_step: string;
  status: string;
  provider_response?: any;
  timestamp: Date;
}

export interface SellerQualityScore {
  seller_id: string;
  overall_score: number;
  catalog_score: number;
  operations_score: number;
  satisfaction_score: number;
  calculated_at: Date;
  metrics: {
    image_quality_score: number;
    description_completeness: number;
    attribute_fill_rate: number;
    duplicate_listing_score: number;
    order_fulfillment_rate: number;
    on_time_shipping_rate: number;
    seller_cancellation_rate: number;
    seller_response_time: number;
    average_product_rating: number;
    order_defect_rate: number;
    return_rate: number;
  };
}