import axios, { AxiosResponse } from 'axios';
import { performance } from 'perf_hooks';
import { EventEmitter } from 'events';
import { logger } from '../../shared/utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface LoadTestConfig {
  name: string;
  baseUrl: string;
  duration: number; // seconds
  rampUpTime?: number; // seconds
  users: number;
  scenarios: TestScenario[];
  thresholds?: Threshold[];
  reportPath?: string;
}

export interface TestScenario {
  name: string;
  weight: number; // Percentage of users
  steps: TestStep[];
  thinkTime?: number; // milliseconds between steps
}

export interface TestStep {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  headers?: Record<string, string>;
  body?: any;
  validate?: (response: AxiosResponse) => boolean;
  extractors?: Record<string, (response: AxiosResponse) => any>;
}

export interface Threshold {
  metric: 'response_time_p95' | 'response_time_avg' | 'error_rate' | 'throughput';
  value: number;
  abortOnFail?: boolean;
}

export interface TestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  responseTimeMin: number;
  responseTimeMax: number;
  responseTimeAvg: number;
  responseTimeP50: number;
  responseTimeP95: number;
  responseTimeP99: number;
  throughput: number;
  errorRate: number;
  statusCodes: Record<number, number>;
  errors: string[];
}

export interface VirtualUser {
  id: number;
  scenario: TestScenario;
  variables: Record<string, any>;
  metrics: {
    requestCount: number;
    errorCount: number;
    totalResponseTime: number;
  };
}

export class LoadTestFramework extends EventEmitter {
  private config: LoadTestConfig;
  private users: VirtualUser[] = [];
  private metrics: TestMetrics;
  private responseTimes: number[] = [];
  private startTime: number = 0;
  private running: boolean = false;
  private abortController: AbortController;

  constructor(config: LoadTestConfig) {
    super();
    this.config = config;
    this.abortController = new AbortController();
    this.metrics = this.initializeMetrics();
  }

  private initializeMetrics(): TestMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimeMin: Infinity,
      responseTimeMax: 0,
      responseTimeAvg: 0,
      responseTimeP50: 0,
      responseTimeP95: 0,
      responseTimeP99: 0,
      throughput: 0,
      errorRate: 0,
      statusCodes: {},
      errors: [],
    };
  }

  async run(): Promise<TestMetrics> {
    logger.info(`Starting load test: ${this.config.name}`);
    this.running = true;
    this.startTime = performance.now();

    try {
      // Create virtual users
      await this.createVirtualUsers();

      // Start test execution
      const testPromises = this.users.map(user => this.runUserScenario(user));

      // Set test duration timeout
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => {
          this.running = false;
          resolve(null);
        }, this.config.duration * 1000);
      });

      // Wait for test completion or timeout
      await Promise.race([Promise.all(testPromises), timeoutPromise]);

      // Calculate final metrics
      this.calculateFinalMetrics();

      // Check thresholds
      await this.checkThresholds();

      // Generate report
      await this.generateReport();

      return this.metrics;
    } catch (error) {
      logger.error('Load test failed:', error);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async createVirtualUsers(): Promise<void> {
    const rampUpTime = this.config.rampUpTime || 0;
    const usersPerSecond = rampUpTime > 0 ? this.config.users / rampUpTime : this.config.users;

    for (let i = 0; i < this.config.users; i++) {
      const scenario = this.selectScenario();
      
      this.users.push({
        id: i + 1,
        scenario,
        variables: {},
        metrics: {
          requestCount: 0,
          errorCount: 0,
          totalResponseTime: 0,
        },
      });

      // Ramp up delay
      if (rampUpTime > 0 && i < this.config.users - 1) {
        await this.sleep(1000 / usersPerSecond);
      }

      this.emit('user:created', { userId: i + 1, scenario: scenario.name });
    }
  }

  private selectScenario(): TestScenario {
    const random = Math.random() * 100;
    let cumulative = 0;

    for (const scenario of this.config.scenarios) {
      cumulative += scenario.weight;
      if (random <= cumulative) {
        return scenario;
      }
    }

    return this.config.scenarios[0];
  }

  private async runUserScenario(user: VirtualUser): Promise<void> {
    while (this.running) {
      for (const step of user.scenario.steps) {
        if (!this.running) break;

        try {
          await this.executeStep(user, step);
          
          // Think time
          if (user.scenario.thinkTime) {
            await this.sleep(user.scenario.thinkTime);
          }
        } catch (error) {
          logger.error(`User ${user.id} step failed:`, error);
        }
      }
    }
  }

  private async executeStep(user: VirtualUser, step: TestStep): Promise<void> {
    const url = `${this.config.baseUrl}${this.interpolate(step.path, user.variables)}`;
    const startTime = performance.now();

    try {
      const response = await axios({
        method: step.method,
        url,
        headers: this.interpolateObject(step.headers || {}, user.variables),
        data: step.body ? this.interpolateObject(step.body, user.variables) : undefined,
        signal: this.abortController.signal,
        validateStatus: () => true, // Don't throw on any status
      });

      const responseTime = performance.now() - startTime;

      // Record metrics
      this.recordResponse(response.status, responseTime, user);

      // Validate response
      if (step.validate && !step.validate(response)) {
        throw new Error(`Validation failed for step: ${step.name}`);
      }

      // Extract variables
      if (step.extractors) {
        for (const [key, extractor] of Object.entries(step.extractors)) {
          user.variables[key] = extractor(response);
        }
      }

      // Emit event
      this.emit('request:completed', {
        userId: user.id,
        step: step.name,
        status: response.status,
        responseTime,
      });
    } catch (error: any) {
      const responseTime = performance.now() - startTime;
      
      // Record error
      this.recordError(error, responseTime, user);

      // Emit event
      this.emit('request:failed', {
        userId: user.id,
        step: step.name,
        error: error.message,
        responseTime,
      });
    }
  }

  private recordResponse(status: number, responseTime: number, user: VirtualUser): void {
    this.metrics.totalRequests++;
    user.metrics.requestCount++;

    if (status >= 200 && status < 400) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
      user.metrics.errorCount++;
    }

    // Record response time
    this.responseTimes.push(responseTime);
    user.metrics.totalResponseTime += responseTime;

    // Update min/max
    this.metrics.responseTimeMin = Math.min(this.metrics.responseTimeMin, responseTime);
    this.metrics.responseTimeMax = Math.max(this.metrics.responseTimeMax, responseTime);

    // Record status code
    this.metrics.statusCodes[status] = (this.metrics.statusCodes[status] || 0) + 1;
  }

  private recordError(error: any, responseTime: number, user: VirtualUser): void {
    this.metrics.totalRequests++;
    this.metrics.failedRequests++;
    user.metrics.requestCount++;
    user.metrics.errorCount++;

    // Record response time even for errors
    this.responseTimes.push(responseTime);
    user.metrics.totalResponseTime += responseTime;

    // Record error message
    const errorMessage = error.message || 'Unknown error';
    if (!this.metrics.errors.includes(errorMessage)) {
      this.metrics.errors.push(errorMessage);
    }
  }

  private calculateFinalMetrics(): void {
    const elapsed = (performance.now() - this.startTime) / 1000; // seconds

    // Calculate averages
    if (this.responseTimes.length > 0) {
      this.metrics.responseTimeAvg = 
        this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;

      // Sort for percentiles
      const sorted = [...this.responseTimes].sort((a, b) => a - b);
      
      this.metrics.responseTimeP50 = this.getPercentile(sorted, 50);
      this.metrics.responseTimeP95 = this.getPercentile(sorted, 95);
      this.metrics.responseTimeP99 = this.getPercentile(sorted, 99);
    }

    // Calculate throughput and error rate
    this.metrics.throughput = this.metrics.totalRequests / elapsed;
    this.metrics.errorRate = 
      this.metrics.totalRequests > 0 
        ? (this.metrics.failedRequests / this.metrics.totalRequests) * 100
        : 0;
  }

  private getPercentile(sortedArray: number[], percentile: number): number {
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
  }

  private async checkThresholds(): Promise<void> {
    if (!this.config.thresholds) return;

    for (const threshold of this.config.thresholds) {
      let value: number;
      
      switch (threshold.metric) {
        case 'response_time_p95':
          value = this.metrics.responseTimeP95;
          break;
        case 'response_time_avg':
          value = this.metrics.responseTimeAvg;
          break;
        case 'error_rate':
          value = this.metrics.errorRate;
          break;
        case 'throughput':
          value = this.metrics.throughput;
          break;
      }

      if (value > threshold.value) {
        const message = `Threshold failed: ${threshold.metric} = ${value} > ${threshold.value}`;
        logger.error(message);
        
        if (threshold.abortOnFail) {
          this.abort();
          throw new Error(message);
        }
      } else {
        logger.info(`Threshold passed: ${threshold.metric} = ${value} <= ${threshold.value}`);
      }
    }
  }

  private async generateReport(): Promise<void> {
    const report = {
      testName: this.config.name,
      startTime: new Date(Date.now() - (performance.now() - this.startTime)).toISOString(),
      endTime: new Date().toISOString(),
      duration: (performance.now() - this.startTime) / 1000,
      configuration: {
        users: this.config.users,
        duration: this.config.duration,
        rampUpTime: this.config.rampUpTime,
        scenarios: this.config.scenarios.map(s => ({
          name: s.name,
          weight: s.weight,
          steps: s.steps.length,
        })),
      },
      metrics: this.metrics,
      userMetrics: this.users.map(u => ({
        id: u.id,
        scenario: u.scenario.name,
        requests: u.metrics.requestCount,
        errors: u.metrics.errorCount,
        avgResponseTime: 
          u.metrics.requestCount > 0 
            ? u.metrics.totalResponseTime / u.metrics.requestCount
            : 0,
      })),
    };

    // Save report
    if (this.config.reportPath) {
      const reportPath = path.join(
        this.config.reportPath,
        `load-test-${Date.now()}.json`
      );
      
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
      logger.info(`Report saved to: ${reportPath}`);
    }

    // Log summary
    this.logSummary();
  }

  private logSummary(): void {
    console.log('\n=== Load Test Summary ===');
    console.log(`Test: ${this.config.name}`);
    console.log(`Duration: ${(performance.now() - this.startTime) / 1000}s`);
    console.log(`Virtual Users: ${this.config.users}`);
    console.log('\n--- Results ---');
    console.log(`Total Requests: ${this.metrics.totalRequests}`);
    console.log(`Successful: ${this.metrics.successfulRequests}`);
    console.log(`Failed: ${this.metrics.failedRequests}`);
    console.log(`Error Rate: ${this.metrics.errorRate.toFixed(2)}%`);
    console.log(`Throughput: ${this.metrics.throughput.toFixed(2)} req/s`);
    console.log('\n--- Response Times (ms) ---');
    console.log(`Min: ${this.metrics.responseTimeMin.toFixed(2)}`);
    console.log(`Avg: ${this.metrics.responseTimeAvg.toFixed(2)}`);
    console.log(`P50: ${this.metrics.responseTimeP50.toFixed(2)}`);
    console.log(`P95: ${this.metrics.responseTimeP95.toFixed(2)}`);
    console.log(`P99: ${this.metrics.responseTimeP99.toFixed(2)}`);
    console.log(`Max: ${this.metrics.responseTimeMax.toFixed(2)}`);
    
    if (Object.keys(this.metrics.statusCodes).length > 0) {
      console.log('\n--- Status Codes ---');
      for (const [code, count] of Object.entries(this.metrics.statusCodes)) {
        console.log(`${code}: ${count}`);
      }
    }

    if (this.metrics.errors.length > 0) {
      console.log('\n--- Errors ---');
      this.metrics.errors.slice(0, 5).forEach(error => {
        console.log(`- ${error}`);
      });
      if (this.metrics.errors.length > 5) {
        console.log(`... and ${this.metrics.errors.length - 5} more`);
      }
    }
  }

  private interpolate(str: string, variables: Record<string, any>): string {
    return str.replace(/\${(\w+)}/g, (match, key) => {
      return variables[key] || match;
    });
  }

  private interpolateObject(obj: any, variables: Record<string, any>): any {
    if (typeof obj === 'string') {
      return this.interpolate(obj, variables);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.interpolateObject(item, variables));
    }

    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.interpolateObject(value, variables);
      }
      return result;
    }

    return obj;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  abort(): void {
    this.running = false;
    this.abortController.abort();
    logger.info('Load test aborted');
  }
}

// Pre-defined test scenarios
export const testScenarios = {
  // Seller service load test
  sellerService: {
    name: 'Seller Service Load Test',
    baseUrl: process.env.SELLER_SERVICE_URL || 'http://localhost:3001',
    duration: 60,
    rampUpTime: 10,
    users: 100,
    scenarios: [
      {
        name: 'Browse Sellers',
        weight: 40,
        steps: [
          {
            name: 'List Sellers',
            method: 'GET',
            path: '/api/sellers',
          },
          {
            name: 'Get Seller Details',
            method: 'GET',
            path: '/api/sellers/${sellerId}',
            extractors: {
              sellerId: (res) => res.data.sellers?.[0]?.id || '1',
            },
          },
        ],
        thinkTime: 2000,
      },
      {
        name: 'Seller Registration',
        weight: 20,
        steps: [
          {
            name: 'Register Seller',
            method: 'POST',
            path: '/api/sellers',
            body: {
              name: 'Test Seller ${userId}',
              email: 'seller${userId}@test.com',
              phone: '+919876543210',
            },
            extractors: {
              sellerId: (res) => res.data.seller?.id,
            },
          },
          {
            name: 'Upload Documents',
            method: 'POST',
            path: '/api/sellers/${sellerId}/documents',
            body: {
              type: 'pan_card',
              url: 'https://example.com/doc.pdf',
            },
          },
        ],
        thinkTime: 3000,
      },
      {
        name: 'Analytics',
        weight: 40,
        steps: [
          {
            name: 'Get Analytics',
            method: 'GET',
            path: '/api/analytics/dashboard',
          },
          {
            name: 'Get SQS Scores',
            method: 'GET',
            path: '/api/sellers/sqs/leaderboard',
          },
        ],
        thinkTime: 5000,
      },
    ],
    thresholds: [
      {
        metric: 'response_time_p95',
        value: 2000,
      },
      {
        metric: 'error_rate',
        value: 5,
        abortOnFail: true,
      },
    ],
  } as LoadTestConfig,

  // Review service stress test
  reviewStressTest: {
    name: 'Review Service Stress Test',
    baseUrl: process.env.REVIEW_SERVICE_URL || 'http://localhost:3002',
    duration: 120,
    rampUpTime: 30,
    users: 500,
    scenarios: [
      {
        name: 'Read Reviews',
        weight: 70,
        steps: [
          {
            name: 'Get Product Reviews',
            method: 'GET',
            path: '/api/reviews/product/${productId}',
            extractors: {
              productId: () => Math.floor(Math.random() * 1000) + 1,
            },
          },
        ],
        thinkTime: 1000,
      },
      {
        name: 'Submit Reviews',
        weight: 30,
        steps: [
          {
            name: 'Submit Review',
            method: 'POST',
            path: '/api/reviews',
            body: {
              productId: '${productId}',
              rating: 4,
              text: 'Great product!',
            },
            extractors: {
              productId: () => Math.floor(Math.random() * 1000) + 1,
            },
            validate: (res) => res.status === 201,
          },
        ],
        thinkTime: 5000,
      },
    ],
    thresholds: [
      {
        metric: 'throughput',
        value: 100,
      },
    ],
  } as LoadTestConfig,
};

// Utility function to run load test
export async function runLoadTest(config: LoadTestConfig): Promise<TestMetrics> {
  const loadTest = new LoadTestFramework(config);
  
  // Add event listeners for real-time monitoring
  loadTest.on('user:created', (data) => {
    logger.debug(`Virtual user ${data.userId} created with scenario: ${data.scenario}`);
  });

  loadTest.on('request:completed', (data) => {
    logger.debug(`Request completed: User ${data.userId}, Step: ${data.step}, Status: ${data.status}, Time: ${data.responseTime}ms`);
  });

  loadTest.on('request:failed', (data) => {
    logger.warn(`Request failed: User ${data.userId}, Step: ${data.step}, Error: ${data.error}`);
  });

  return loadTest.run();
}