import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Mock external services
jest.mock('amqplib', () => ({
  connect: jest.fn(() => Promise.resolve({
    createChannel: jest.fn(() => Promise.resolve({
      assertExchange: jest.fn(),
      assertQueue: jest.fn(() => Promise.resolve({ queue: 'test-queue' })),
      bindQueue: jest.fn(),
      prefetch: jest.fn(),
      consume: jest.fn(),
      ack: jest.fn(),
      nack: jest.fn(),
      close: jest.fn(),
    })),
    close: jest.fn(),
  })),
}));

jest.mock('aws-sdk', () => ({
  S3: jest.fn(() => ({
    upload: jest.fn(() => ({
      promise: jest.fn(() => Promise.resolve({
        Location: 'https://s3.amazonaws.com/test-bucket/test-file.jpg',
      })),
    })),
    getSignedUrlPromise: jest.fn(() => Promise.resolve('https://signed-url.com')),
    deleteObject: jest.fn(() => ({
      promise: jest.fn(() => Promise.resolve()),
    })),
    getObject: jest.fn(() => ({
      promise: jest.fn(() => Promise.resolve({
        Body: Buffer.from('test-file-content'),
      })),
    })),
  })),
}));

jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    hget: jest.fn(),
    hset: jest.fn(),
    hincrby: jest.fn(),
    zadd: jest.fn(),
    expire: jest.fn(),
    on: jest.fn(),
  })),
}));

// Set test timeout
jest.setTimeout(30000);

// Suppress console logs during tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};