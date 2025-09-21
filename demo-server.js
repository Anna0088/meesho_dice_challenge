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
  console.log('\n======================================');
  console.log('   Meesho Ecosystem Demo Server');
  console.log('======================================');
  console.log('\nServer running at:');
  console.log(`  http://localhost:${PORT}`);
  console.log('\nAvailable endpoints:');
  console.log('  GET  / - API documentation');
  console.log('  GET  /health - Health check');
  console.log('  GET  /api/sellers - List all sellers');
  console.log('  GET  /api/sellers/:id - Get seller details');
  console.log('  POST /api/sellers - Create new seller');
  console.log('  GET  /api/reviews - List all reviews');
  console.log('  POST /api/reviews - Create new review');
  console.log('  GET  /api/loyalty/tiers - Get loyalty tiers');
  console.log('\nPress Ctrl+C to stop\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  process.exit(0);
});
