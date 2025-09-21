# 🛍️ GreenBharat - Sustainable E-commerce Ecosystem (Meesho Reimagined)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-%3E%3D4.9.0-blue.svg)
![React](https://img.shields.io/badge/react-18.3-61DAFB.svg)
![Vite](https://img.shields.io/badge/vite-7.1-646CFF.svg)
![TailwindCSS](https://img.shields.io/badge/tailwind-3.4-38B2AC.svg)
![Docker](https://img.shields.io/badge/docker-%3E%3D20.10-blue.svg)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

> A comprehensive full-stack e-commerce ecosystem featuring a modern React frontend with sustainability theme, AI-powered seller quality scoring, ML-driven review integrity, and gamified customer loyalty programs.

## 📋 Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Frontend Setup](#frontend-setup)
- [Backend Setup](#backend-setup)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

## 🎯 Overview

GreenBharat is a sustainable, enterprise-grade e-commerce platform that revolutionizes online marketplace operations through:
- **Sustainability Focus**: Green-themed UI promoting eco-friendly products and practices
- **Modern Frontend**: React 18 with TypeScript, Vite, and Tailwind CSS for blazing-fast performance
- **AI-Driven Quality Assurance**: Automated seller verification and quality scoring
- **Trust & Safety**: ML-powered fake review detection and content moderation
- **Customer Engagement**: Gamified loyalty program with rewards and achievements
- **Real-time Analytics**: Comprehensive insights and predictive analytics
- **Voice-Enabled**: Integrated voice assistant for accessibility

## 🏗️ Architecture

### Microservices Architecture
```
┌──────────────────────────────────────────────────────────────┐
│                        API Gateway                          │
├──────────┬───────────┬───────────┬───────────┬────────────────┤
│ Seller  │  Review  │ Loyalty  │Analytics │  Integration   │
│ Service │  Service │ Service  │ Service  │    Layer       │
├──────────┴───────────┴───────────┴───────────┴────────────────┤
│                    Event Bus (RabbitMQ)                     │
├──────────────────────────────────────────────────────────────┤
│     PostgreSQL    │    Redis    │  Elasticsearch │ S3      │
└──────────────────────────────────────────────────────────────┘
```

### Service Components

| Service | Port | Description | Status |
|---------|------|-------------|--------|
| **Seller Service** | 3001 | Manages seller profiles, verification, and SQS calculation | ✅ Active |
| **Review Service** | 3002 | Handles reviews with ML-powered fake detection | ✅ Active |
| **Loyalty Service** | 3003 | Gamified loyalty program (Meesho Stars) | ✅ Active |
| **Analytics Service** | 3004 | Real-time analytics and insights | ✅ Active |

## ✨ Key Features

### 🏆 Seller Quality Score (SQS)
- **Dynamic Scoring Algorithm**
  - Product Quality Metrics (40%)
  - Customer Satisfaction Index (30%)
  - Operational Efficiency (30%)
- **Real-time Updates**: Score recalculation on every transaction
- **Tier System**: Individual → Small Business → Verified Brand
- **Performance Analytics**: Historical trends and predictive insights

### 🔍 Review Integrity System
- **ML-Powered Detection**
  - BERT-based NLP for text analysis
  - Behavioral anomaly detection
  - Pattern recognition algorithms
- **Two-Layer Moderation**
  - Automated flagging (Layer 1)
  - Human review queue (Layer 2)
- **Video Reviews**: Support for authentic video testimonials
- **Trust Scores**: Review authenticity ratings

### ⭐ Meesho Stars Loyalty Program
- **Tiered Rewards System**
  - 🥉 Bronze Star (0-999 points)
  - 🥈 Silver Star (1000-4999 points)
  - 🥇 Gold Star (5000-9999 points)
  - 💎 Platinum Star (10000+ points)
- **Gamification Elements**
  - Achievement badges
  - Daily missions
  - Streak bonuses
  - Social sharing rewards
- **Redemption Options**
  - Cashback rewards
  - Exclusive discounts
  - Early access to sales
  - Free shipping vouchers

### 📊 Advanced Analytics
- **Real-time Dashboards**: Live metrics and KPIs
- **Predictive Analytics**: ML-based forecasting
- **Custom Reports**: Exportable data insights
- **Performance Monitoring**: Service health and metrics

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 18.3 with TypeScript
- **Build Tool**: Vite 7.1 for lightning-fast HMR
- **Styling**: Tailwind CSS 3.4 with custom sustainability theme
- **State Management**: React Hooks & Context API
- **HTTP Client**: Axios for API communication
- **Icons**: Lucide React for modern iconography
- **Notifications**: React Hot Toast for user feedback

### Backend
- **Runtime**: Node.js 16+ with TypeScript 4.9+
- **Framework**: Express.js with middleware ecosystem
- **API**: RESTful with OpenAPI 3.0 specification

### Databases
- **Primary**: PostgreSQL 14+ (relational data)
- **Cache**: Redis 7+ (session, cache, pub/sub)
- **Search**: Elasticsearch 8+ (full-text search)
- **Time-series**: TimescaleDB (analytics)

### Infrastructure
- **Containers**: Docker 20.10+ & Docker Compose
- **Orchestration**: Kubernetes (production)
- **Message Queue**: RabbitMQ 3.11+
- **Storage**: AWS S3 compatible (MinIO for local)

### ML/AI
- **NLP**: TensorFlow.js with BERT models
- **Computer Vision**: Image verification
- **Analytics**: Prophet for time-series forecasting

### Monitoring & Observability
- **Metrics**: Prometheus + Grafana
- **Tracing**: OpenTelemetry
- **Logging**: Winston with ELK stack
- **APM**: Custom performance monitoring

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed:
- Node.js 16+ and npm 8+
- Docker Desktop (optional, for full infrastructure)
- Git

### Quick Start (Full Application)

```bash
# Clone the repository
git clone https://github.com/yourusername/greenbharat-ecosystem.git
cd greenbharat-ecosystem

# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..

# Run both backend and frontend
# Terminal 1 - Backend
chmod +x run-local.sh
./run-local.sh
# Backend available at http://localhost:3000

# Terminal 2 - Frontend
cd frontend
npm run dev
# Frontend available at http://localhost:5173
```

## 🎨 Frontend Setup

### Development Mode
```bash
cd frontend
npm install
npm run dev
# Visit http://localhost:5173
```

### Production Build
```bash
cd frontend
npm run build
npm run preview
```

### Frontend Features
- 🌱 **Sustainability Theme**: Green-focused design with eco-friendly branding
- 📱 **Responsive Design**: Mobile-first approach with Tailwind CSS
- 🎨 **Custom Theme Colors**:
  - Primary Green: `#10B981`
  - Eco Mint: `#6EE7B7`
  - Earth Tones: Brown, Beige, Orange
  - Sky & Ocean Blues
- 🔊 **Voice Assistant**: Integrated voice commands for accessibility
- 📊 **Interactive Dashboards**: Real-time data visualization
- 🛒 **Marketplace View**: Browse eco-friendly products
- ⭐ **Rewards Center**: Track loyalty points and achievements

## 🔧 Backend Setup

### Full Installation (with Docker)

```bash
# Clone the repository
git clone https://github.com/yourusername/meesho-ecosystem.git
cd meesho-ecosystem

# Run the setup script
chmod +x setup.sh
./setup.sh

# This will:
# - Install all dependencies
# - Set up environment variables
# - Start Docker containers
# - Initialize databases
```

### Manual Installation

```bash
# Install dependencies
npm install
npm run bootstrap  # Install dependencies for all services

# Configure environment
cp .env.example .env
# Edit .env with your configuration

# Start infrastructure (requires Docker)
docker compose up -d postgres redis rabbitmq elasticsearch

# Initialize databases
npm run db:migrate
npm run db:seed  # Optional: Load sample data

# Start services
npm run dev  # Development mode
npm start    # Production mode
```

## 📁 Project Structure

```
greenbharat-ecosystem/
├── frontend/               # React Frontend Application
│   ├── src/               # Source code
│   │   ├── App.tsx        # Main application component
│   │   ├── main.tsx       # Application entry point
│   │   └── index.css      # Tailwind CSS imports
│   ├── public/            # Static assets
│   ├── index.html         # HTML template
│   ├── vite.config.ts     # Vite configuration
│   ├── tailwind.config.js # Tailwind CSS configuration
│   ├── postcss.config.js  # PostCSS configuration
│   ├── tsconfig.json      # TypeScript configuration
│   └── package.json       # Frontend dependencies
├── services/              # Backend Microservices
│   ├── seller-service/    # Seller management & SQS
│   ├── review-service/    # Review & moderation
│   ├── loyalty-service/   # Gamification & rewards
│   └── analytics-service/ # Analytics & reporting
├── shared/                # Shared utilities
│   ├── config/           # Configuration management
│   ├── integration/      # Service mesh & event bus
│   ├── monitoring/       # Observability tools
│   ├── optimization/     # Performance optimization
│   ├── security/         # Rate limiting & auth
│   └── synchronization/  # Data sync pipeline
├── infrastructure/       # Infrastructure as Code
│   ├── docker/          # Docker configurations
│   └── kubernetes/      # K8s manifests
├── tests/               # Testing suites
│   ├── unit/           # Unit tests
│   ├── integration/    # Integration tests
│   └── load/          # Load testing framework
├── docs/               # Documentation
├── demo-server.js      # Express demo backend
├── docker-compose.yml  # Local development setup
├── setup.sh           # Quick setup script
└── run-local.sh       # Backend server launcher
```

## 📚 API Documentation

### Demo Server Endpoints

The demo server (http://localhost:3000) provides these endpoints:

```bash
# API Information
GET  /                      # API documentation
GET  /health               # Health check

# Seller Management
GET  /api/sellers          # List all sellers
GET  /api/sellers/:id      # Get seller details
POST /api/sellers          # Create new seller

# Review System
GET  /api/reviews          # List all reviews
POST /api/reviews          # Create new review

# Loyalty Program
GET  /api/loyalty/tiers    # Get loyalty tiers
```

### Sample API Calls

```bash
# Get all sellers
curl http://localhost:3000/api/sellers

# Create a new seller
curl -X POST http://localhost:3000/api/sellers \
  -H "Content-Type: application/json" \
  -d '{"name": "New Seller", "email": "seller@example.com"}'

# Submit a review
curl -X POST http://localhost:3000/api/reviews \
  -H "Content-Type: application/json" \
  -d '{"product": "Product Name", "rating": 5}'

# Get loyalty tiers
curl http://localhost:3000/api/loyalty/tiers
```

## 🧪 Testing

### Run All Tests
```bash
npm test
```

### Unit Tests
```bash
npm run test:unit
```

### Integration Tests
```bash
npm run test:integration
```

### Load Testing
```bash
npm run test:load
```

### Test Coverage
```bash
npm run test:coverage
```

## 🚢 Deployment

### Docker Deployment
```bash
# Build all services
docker compose build

# Deploy locally
docker compose up -d

# Scale services
docker compose up -d --scale seller-service=3
```

### Kubernetes Deployment
```bash
# Apply configurations
kubectl apply -f infrastructure/kubernetes/

# Check deployment status
kubectl get pods -n meesho-ecosystem
```

### Environment Variables

Key environment variables (see `.env.example` for full list):

```env
# Application
NODE_ENV=development
PORT=3000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=meesho_db
DB_USER=postgres
DB_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# RabbitMQ
RABBITMQ_URL=amqp://guest:guest@localhost:5672

# Elasticsearch
ELASTICSEARCH_URL=http://localhost:9200

# AWS (for S3 storage)
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-west-2

# Security
JWT_SECRET=your-secret-key
ENCRYPTION_KEY=your-encryption-key
```

## 🌍 Sustainability Commitment

GreenBharat is committed to promoting sustainable e-commerce:
- 🌱 Carbon-neutral shipping options
- ♻️ Eco-friendly packaging recommendations
- 🏆 Rewards for choosing sustainable products
- 📊 Environmental impact tracking
- 🤝 Partnership with green vendors

---

<p align="center">
  Made with ❤️ and 🌱 by the GreenBharat Team
  <br/>
  <em>Building a sustainable future, one transaction at a time</em>
</p>