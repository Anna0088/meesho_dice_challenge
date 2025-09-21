#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

clear
echo "${BLUE}========================================${NC}"
echo "${BLUE}     Meesho Ecosystem Runner${NC}"
echo "${BLUE}========================================${NC}"
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "${YELLOW}Checking prerequisites...${NC}"

if ! command_exists node; then
    echo "${RED}✗ Node.js is not installed${NC}"
    echo "Please install Node.js from: https://nodejs.org/"
    exit 1
fi
echo "${GREEN}✓ Node.js $(node --version)${NC}"

if ! command_exists npm; then
    echo "${RED}✗ npm is not installed${NC}"
    exit 1
fi
echo "${GREEN}✓ npm $(npm --version)${NC}"

# Check for Docker (optional)
if command_exists docker && docker info &>/dev/null; then
    echo "${GREEN}✓ Docker is running${NC}"
    DOCKER_AVAILABLE=true
else
    echo "${YELLOW}⚠ Docker is not running. Using in-memory/mock services${NC}"
    DOCKER_AVAILABLE=false
fi

echo ""
echo "${YELLOW}Setting up environment...${NC}"

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "${GREEN}✓ Created .env file${NC}"
fi

# Set development environment
export NODE_ENV=development
export PORT=3000

# If Docker is not available, use mock/in-memory services
if [ "$DOCKER_AVAILABLE" = false ]; then
    export USE_MOCK_DB=true
    export USE_MOCK_REDIS=true
    export USE_MOCK_RABBITMQ=true
    echo "${YELLOW}Using mock services for development${NC}"
fi

echo ""
echo "${YELLOW}Starting services...${NC}"
echo ""

# Create a simple demo server
cat > demo-server.js << 'EOF'
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Mock data
const sellers = [
  { id: 1, name: 'Artisan Crafts India', tier: 'verified_brand', sqs_score: 92 },
  { id: 2, name: 'Fashion Hub Delhi', tier: 'small_business', sqs_score: 78 },
  { id: 3, name: 'Electronics Bazaar', tier: 'individual', sqs_score: 65 }
];

const reviews = [
  { id: 1, product: 'Handcrafted Jewelry', rating: 5, verified: true },
  { id: 2, product: 'Designer Saree', rating: 4, verified: true },
  { id: 3, product: 'Bluetooth Speaker', rating: 3, verified: false }
];

const loyaltyTiers = [
  { tier: 'Bronze Star', minPoints: 0, benefits: ['5% cashback'] },
  { tier: 'Silver Star', minPoints: 1000, benefits: ['10% cashback', 'Free shipping'] },
  { tier: 'Gold Star', minPoints: 5000, benefits: ['15% cashback', 'Priority support', 'Early access'] }
];

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Meesho Ecosystem API',
    version: '1.0.0',
    services: {
      sellers: '/api/sellers',
      reviews: '/api/reviews',
      loyalty: '/api/loyalty',
      health: '/health'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      seller_service: 'healthy',
      review_service: 'healthy',
      loyalty_service: 'healthy'
    }
  });
});

app.get('/api/sellers', (req, res) => {
  res.json({ sellers, total: sellers.length });
});

app.get('/api/sellers/:id', (req, res) => {
  const seller = sellers.find(s => s.id === parseInt(req.params.id));
  if (seller) {
    res.json(seller);
  } else {
    res.status(404).json({ error: 'Seller not found' });
  }
});

app.get('/api/reviews', (req, res) => {
  res.json({ reviews, total: reviews.length });
});

app.get('/api/loyalty/tiers', (req, res) => {
  res.json({ tiers: loyaltyTiers });
});

app.post('/api/sellers', (req, res) => {
  const newSeller = {
    id: sellers.length + 1,
    name: req.body.name || 'New Seller',
    tier: 'individual',
    sqs_score: Math.floor(Math.random() * 30) + 50
  };
  sellers.push(newSeller);
  res.status(201).json(newSeller);
});

app.post('/api/reviews', (req, res) => {
  const newReview = {
    id: reviews.length + 1,
    product: req.body.product || 'Unknown Product',
    rating: req.body.rating || 3,
    verified: false
  };
  reviews.push(newReview);
  res.status(201).json(newReview);
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log('\n\033[0;32m======================================\033[0m');
  console.log('\033[0;32m   Meesho Ecosystem Demo Server\033[0m');
  console.log('\033[0;32m======================================\033[0m');
  console.log('\n\033[0;33mServer running at:\033[0m');
  console.log(`  \033[0;36mhttp://localhost:${PORT}\033[0m`);
  console.log('\n\033[0;33mAvailable endpoints:\033[0m');
  console.log('  GET  / - API documentation');
  console.log('  GET  /health - Health check');
  console.log('  GET  /api/sellers - List all sellers');
  console.log('  GET  /api/sellers/:id - Get seller details');
  console.log('  POST /api/sellers - Create new seller');
  console.log('  GET  /api/reviews - List all reviews');
  console.log('  POST /api/reviews - Create new review');
  console.log('  GET  /api/loyalty/tiers - Get loyalty tiers');
  console.log('\n\033[0;33mPress Ctrl+C to stop\033[0m\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\033[0;31mShutting down server...\033[0m');
  process.exit(0);
});
EOF

# Install express if not already installed
if [ ! -d "node_modules/express" ]; then
    echo "Installing Express..."
    npm install express --save --silent 2>/dev/null
fi

# Run the demo server
echo "${GREEN}Starting Meesho Ecosystem Demo Server...${NC}"
echo ""
node demo-server.js