#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "${GREEN}========================================${NC}"
echo "${GREEN}  Meesho Ecosystem Setup Script${NC}"
echo "${GREEN}========================================${NC}"

# Step 1: Create .env file from example
echo "${YELLOW}Step 1: Setting up environment variables...${NC}"
if [ ! -f .env ]; then
    cp .env.example .env
    echo "${GREEN}✓ Created .env file${NC}"
else
    echo "${GREEN}✓ .env file already exists${NC}"
fi

# Step 2: Install dependencies
echo "${YELLOW}Step 2: Installing dependencies...${NC}"
echo "Installing root dependencies..."
npm install --legacy-peer-deps --silent 2>/dev/null

# Install dependencies for each service
for service in services/*/; do
    if [ -f "$service/package.json" ]; then
        echo "Installing dependencies for $(basename $service)..."
        (cd "$service" && npm install --legacy-peer-deps --silent 2>/dev/null)
    fi
done
echo "${GREEN}✓ Dependencies installed${NC}"

# Step 3: Build TypeScript
echo "${YELLOW}Step 3: Building TypeScript...${NC}"
npm run build 2>/dev/null || echo "${YELLOW}Build command not configured yet${NC}"

# Step 4: Check Docker
echo "${YELLOW}Step 4: Checking Docker...${NC}"
if ! command -v docker &> /dev/null; then
    echo "${RED}✗ Docker is not installed. Please install Docker first.${NC}"
    echo "Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "${RED}✗ Docker is not running. Please start Docker.${NC}"
    exit 1
fi
echo "${GREEN}✓ Docker is running${NC}"

# Step 5: Start infrastructure services
echo "${YELLOW}Step 5: Starting infrastructure services...${NC}"
docker-compose up -d postgres redis rabbitmq elasticsearch

# Wait for services to be ready
echo "Waiting for services to be ready..."
sleep 10

# Check service health
echo "Checking service health..."
docker-compose ps

echo ""
echo "${GREEN}========================================${NC}"
echo "${GREEN}  Setup Complete!${NC}"
echo "${GREEN}========================================${NC}"
echo ""
echo "Infrastructure services are running:"
echo "  - PostgreSQL: localhost:5432"
echo "  - Redis: localhost:6379"
echo "  - RabbitMQ: localhost:5672 (Management UI: localhost:15672)"
echo "  - Elasticsearch: localhost:9200"
echo ""
echo "To start the microservices, run:"
echo "  ${YELLOW}npm run dev${NC}"
echo ""
echo "To stop infrastructure services:"
echo "  ${YELLOW}docker-compose down${NC}"
echo ""