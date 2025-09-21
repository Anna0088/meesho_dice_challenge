-- Create databases for different services
CREATE DATABASE IF NOT EXISTS meesho_sellers;
CREATE DATABASE IF NOT EXISTS meesho_reviews;
CREATE DATABASE IF NOT EXISTS meesho_loyalty;

-- Switch to sellers database
\c meesho_sellers;

-- Create enum types
CREATE TYPE seller_tier AS ENUM ('individual', 'small_business', 'verified_brand');
CREATE TYPE verification_status AS ENUM ('pending', 'info_required', 'verification_in_progress', 'approved', 'rejected');

-- Seller profiles table
CREATE TABLE seller_profiles (
    seller_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    business_name VARCHAR(255),
    tier seller_tier NOT NULL,
    verification_status verification_status NOT NULL DEFAULT 'pending',
    gstin VARCHAR(15),
    pan VARCHAR(10),
    bank_account_verified BOOLEAN DEFAULT FALSE,
    sqs_score INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Verification documents table
CREATE TABLE verification_documents (
    document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES seller_profiles(seller_id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    storage_url TEXT NOT NULL,
    verification_status verification_status NOT NULL DEFAULT 'pending',
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    CONSTRAINT unique_seller_document UNIQUE(seller_id, document_type)
);

-- Verification history table
CREATE TABLE verification_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES seller_profiles(seller_id) ON DELETE CASCADE,
    verification_step VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    provider_response JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seller quality scores table
CREATE TABLE seller_quality_scores (
    score_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES seller_profiles(seller_id) ON DELETE CASCADE,
    overall_score INTEGER NOT NULL CHECK (overall_score >= 0 AND overall_score <= 1000),
    catalog_score INTEGER NOT NULL CHECK (catalog_score >= 0 AND catalog_score <= 100),
    operations_score INTEGER NOT NULL CHECK (operations_score >= 0 AND operations_score <= 100),
    satisfaction_score INTEGER NOT NULL CHECK (satisfaction_score >= 0 AND satisfaction_score <= 100),
    metrics JSONB NOT NULL,
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_daily_score UNIQUE(seller_id, DATE(calculated_at))
);

-- Create indexes
CREATE INDEX idx_seller_profiles_email ON seller_profiles(email);
CREATE INDEX idx_seller_profiles_phone ON seller_profiles(phone);
CREATE INDEX idx_seller_profiles_verification_status ON seller_profiles(verification_status);
CREATE INDEX idx_seller_profiles_tier ON seller_profiles(tier);
CREATE INDEX idx_seller_quality_scores_seller_id ON seller_quality_scores(seller_id);
CREATE INDEX idx_seller_quality_scores_calculated_at ON seller_quality_scores(calculated_at);
CREATE INDEX idx_verification_documents_seller_id ON verification_documents(seller_id);
CREATE INDEX idx_verification_history_seller_id ON verification_history(seller_id);

-- Switch to reviews database
\c meesho_reviews;

-- Reviews table
CREATE TABLE reviews (
    review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL,
    user_id UUID NOT NULL,
    seller_id UUID NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    photo_urls TEXT[],
    video_url TEXT,
    is_verified_purchase BOOLEAN DEFAULT FALSE,
    is_incentivized BOOLEAN DEFAULT FALSE,
    genuineness_score DECIMAL(3, 2) CHECK (genuineness_score >= 0 AND genuineness_score <= 1),
    helpful_votes INTEGER DEFAULT 0,
    unhelpful_votes INTEGER DEFAULT 0,
    moderation_status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Review moderation history
CREATE TABLE review_moderation_history (
    moderation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES reviews(review_id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    reason TEXT,
    ml_score DECIMAL(3, 2),
    behavioral_flags JSONB,
    moderator_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_reviews_product_id ON reviews(product_id);
CREATE INDEX idx_reviews_user_id ON reviews(user_id);
CREATE INDEX idx_reviews_seller_id ON reviews(seller_id);
CREATE INDEX idx_reviews_created_at ON reviews(created_at);
CREATE INDEX idx_reviews_moderation_status ON reviews(moderation_status);

-- Switch to loyalty database
\c meesho_loyalty;

-- Create enum types
CREATE TYPE loyalty_tier AS ENUM ('bronze', 'silver', 'gold', 'platinum');
CREATE TYPE transaction_type AS ENUM ('earn', 'redeem', 'expire', 'adjust');

-- User loyalty accounts
CREATE TABLE user_loyalty_accounts (
    user_id UUID PRIMARY KEY,
    current_star_balance INTEGER NOT NULL DEFAULT 0,
    lifetime_stars_earned INTEGER NOT NULL DEFAULT 0,
    current_tier loyalty_tier NOT NULL DEFAULT 'bronze',
    tier_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Points ledger
CREATE TABLE points_ledger (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_loyalty_accounts(user_id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    transaction_type transaction_type NOT NULL,
    source_event_id VARCHAR(255),
    source_event_type VARCHAR(50),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Achievements
CREATE TABLE achievements (
    achievement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    category VARCHAR(50),
    icon_url TEXT,
    points_reward INTEGER DEFAULT 0,
    criteria JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User achievements
CREATE TABLE user_achievements (
    user_id UUID NOT NULL,
    achievement_id UUID NOT NULL REFERENCES achievements(achievement_id) ON DELETE CASCADE,
    earned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, achievement_id)
);

-- Rewards catalog
CREATE TABLE rewards (
    reward_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    star_cost INTEGER NOT NULL,
    tier_requirement loyalty_tier,
    stock_quantity INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Reward redemptions
CREATE TABLE reward_redemptions (
    redemption_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    reward_id UUID NOT NULL REFERENCES rewards(reward_id),
    stars_spent INTEGER NOT NULL,
    redemption_code VARCHAR(50),
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    fulfilled_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes
CREATE INDEX idx_user_loyalty_accounts_tier ON user_loyalty_accounts(current_tier);
CREATE INDEX idx_points_ledger_user_id ON points_ledger(user_id);
CREATE INDEX idx_points_ledger_created_at ON points_ledger(created_at);
CREATE INDEX idx_user_achievements_user_id ON user_achievements(user_id);
CREATE INDEX idx_reward_redemptions_user_id ON reward_redemptions(user_id);
CREATE INDEX idx_reward_redemptions_status ON reward_redemptions(status);