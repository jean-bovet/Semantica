/**
 * Context information for retry operations
 */
export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  lastError: Error;
  totalElapsed: number; // milliseconds
  operationId: string;
  metadata?: Record<string, any>;
}

/**
 * Result of a retry decision
 */
export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  reason: string;
}

/**
 * Configuration for retry strategies
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  timeoutMs?: number;
  retryableErrors?: Array<string | RegExp>;
  nonRetryableErrors?: Array<string | RegExp>;
  onRetry?: (context: RetryContext) => void;
  onMaxAttemptsReached?: (context: RetryContext) => void;
}

/**
 * Base interface for retry strategies
 */
export interface RetryStrategy {
  /**
   * Determine if and how long to wait before retrying
   */
  shouldRetry(context: RetryContext): RetryDecision;

  /**
   * Calculate the delay for the next retry attempt
   */
  calculateDelay(context: RetryContext): number;

  /**
   * Check if an error is retryable
   */
  isRetryableError(error: Error): boolean;

  /**
   * Get strategy configuration
   */
  getConfig(): RetryConfig;

  /**
   * Reset strategy state (for stateful strategies)
   */
  reset(): void;
}

/**
 * Linear backoff strategy - fixed delay between retries
 */
export class LinearRetryStrategy implements RetryStrategy {
  constructor(private config: RetryConfig) {}

  shouldRetry(context: RetryContext): RetryDecision {
    if (context.attempt >= this.config.maxAttempts) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Maximum attempts reached'
      };
    }

    if (this.config.timeoutMs && context.totalElapsed >= this.config.timeoutMs) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Total timeout exceeded'
      };
    }

    if (!this.isRetryableError(context.lastError)) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Error is not retryable'
      };
    }

    const delay = this.calculateDelay(context);
    return {
      shouldRetry: true,
      delayMs: delay,
      reason: `Linear retry with ${delay}ms delay`
    };
  }

  calculateDelay(context: RetryContext): number {
    return Math.min(this.config.initialDelayMs, this.config.maxDelayMs);
  }

  isRetryableError(error: Error): boolean {
    // Check non-retryable errors first
    if (this.config.nonRetryableErrors) {
      for (const pattern of this.config.nonRetryableErrors) {
        if (this.matchesPattern(error, pattern)) {
          return false;
        }
      }
    }

    // If retryable errors are specified, only those are retryable
    if (this.config.retryableErrors) {
      for (const pattern of this.config.retryableErrors) {
        if (this.matchesPattern(error, pattern)) {
          return true;
        }
      }
      return false;
    }

    // Default: most errors are retryable
    return true;
  }

  private matchesPattern(error: Error, pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') {
      return error.message.includes(pattern);
    }
    return pattern.test(error.message);
  }

  getConfig(): RetryConfig {
    return { ...this.config };
  }

  reset(): void {
    // Linear strategy is stateless
  }
}

/**
 * Exponential backoff strategy - increasing delay between retries
 */
export class ExponentialRetryStrategy implements RetryStrategy {
  private baseDelayMs: number;

  constructor(private config: RetryConfig) {
    this.baseDelayMs = config.initialDelayMs;
  }

  shouldRetry(context: RetryContext): RetryDecision {
    if (context.attempt >= this.config.maxAttempts) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Maximum attempts reached'
      };
    }

    if (this.config.timeoutMs && context.totalElapsed >= this.config.timeoutMs) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Total timeout exceeded'
      };
    }

    if (!this.isRetryableError(context.lastError)) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Error is not retryable'
      };
    }

    const delay = this.calculateDelay(context);
    return {
      shouldRetry: true,
      delayMs: delay,
      reason: `Exponential backoff with ${delay}ms delay`
    };
  }

  calculateDelay(context: RetryContext): number {
    const exponentialDelay = this.baseDelayMs * Math.pow(2, context.attempt - 1);
    return Math.min(exponentialDelay, this.config.maxDelayMs);
  }

  isRetryableError(error: Error): boolean {
    // Check non-retryable errors first
    if (this.config.nonRetryableErrors) {
      for (const pattern of this.config.nonRetryableErrors) {
        if (this.matchesPattern(error, pattern)) {
          return false;
        }
      }
    }

    // If retryable errors are specified, only those are retryable
    if (this.config.retryableErrors) {
      for (const pattern of this.config.retryableErrors) {
        if (this.matchesPattern(error, pattern)) {
          return true;
        }
      }
      return false;
    }

    // Default: most errors are retryable
    return true;
  }

  private matchesPattern(error: Error, pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') {
      return error.message.includes(pattern);
    }
    return pattern.test(error.message);
  }

  getConfig(): RetryConfig {
    return { ...this.config };
  }

  reset(): void {
    this.baseDelayMs = this.config.initialDelayMs;
  }
}

/**
 * Jittered exponential backoff strategy - exponential with random jitter
 */
export class JitteredExponentialRetryStrategy extends ExponentialRetryStrategy {
  private jitterFactor: number;

  constructor(config: RetryConfig, jitterFactor = 0.1) {
    super(config);
    this.jitterFactor = Math.max(0, Math.min(1, jitterFactor));
  }

  calculateDelay(context: RetryContext): number {
    const baseDelay = super.calculateDelay(context);
    const jitter = baseDelay * this.jitterFactor * (Math.random() - 0.5) * 2;
    return Math.max(0, Math.min(baseDelay + jitter, this.getConfig().maxDelayMs));
  }
}

/**
 * Circuit breaker retry strategy - stops retrying after too many failures
 */
export class CircuitBreakerRetryStrategy implements RetryStrategy {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private readonly failureThreshold: number;
  private readonly recoveryTimeMs: number;

  constructor(
    private config: RetryConfig,
    failureThreshold = 5,
    recoveryTimeMs = 60000
  ) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeMs = recoveryTimeMs;
  }

  shouldRetry(context: RetryContext): RetryDecision {
    this.updateCircuitState();

    if (this.state === 'open') {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Circuit breaker is open'
      };
    }

    if (context.attempt >= this.config.maxAttempts) {
      this.recordFailure();
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Maximum attempts reached'
      };
    }

    if (this.config.timeoutMs && context.totalElapsed >= this.config.timeoutMs) {
      this.recordFailure();
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Total timeout exceeded'
      };
    }

    if (!this.isRetryableError(context.lastError)) {
      this.recordFailure();
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Error is not retryable'
      };
    }

    const delay = this.calculateDelay(context);
    return {
      shouldRetry: true,
      delayMs: delay,
      reason: `Circuit breaker (${this.state}) retry with ${delay}ms delay`
    };
  }

  calculateDelay(context: RetryContext): number {
    // Use exponential backoff
    const exponentialDelay = this.config.initialDelayMs * Math.pow(2, context.attempt - 1);
    return Math.min(exponentialDelay, this.config.maxDelayMs);
  }

  isRetryableError(error: Error): boolean {
    // Same logic as exponential strategy
    if (this.config.nonRetryableErrors) {
      for (const pattern of this.config.nonRetryableErrors) {
        if (this.matchesPattern(error, pattern)) {
          return false;
        }
      }
    }

    if (this.config.retryableErrors) {
      for (const pattern of this.config.retryableErrors) {
        if (this.matchesPattern(error, pattern)) {
          return true;
        }
      }
      return false;
    }

    return true;
  }

  private matchesPattern(error: Error, pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') {
      return error.message.includes(pattern);
    }
    return pattern.test(error.message);
  }

  private updateCircuitState(): void {
    const now = Date.now();

    if (this.state === 'open' && now - this.lastFailureTime >= this.recoveryTimeMs) {
      this.state = 'half-open';
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
    }
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  getConfig(): RetryConfig {
    return { ...this.config };
  }

  getCircuitState(): { state: string; failureCount: number; lastFailureTime: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
    };
  }

  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = 'closed';
  }
}

/**
 * Adaptive retry strategy - adjusts behavior based on success/failure patterns
 */
export class AdaptiveRetryStrategy implements RetryStrategy {
  private successCount = 0;
  private failureCount = 0;
  private lastDelays: number[] = [];
  private readonly maxHistorySize = 10;

  constructor(private config: RetryConfig) {}

  shouldRetry(context: RetryContext): RetryDecision {
    if (context.attempt >= this.config.maxAttempts) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Maximum attempts reached'
      };
    }

    if (this.config.timeoutMs && context.totalElapsed >= this.config.timeoutMs) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Total timeout exceeded'
      };
    }

    if (!this.isRetryableError(context.lastError)) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Error is not retryable'
      };
    }

    const delay = this.calculateDelay(context);
    this.recordDelay(delay);

    return {
      shouldRetry: true,
      delayMs: delay,
      reason: `Adaptive retry with ${delay}ms delay (success rate: ${this.getSuccessRate().toFixed(2)})`
    };
  }

  calculateDelay(context: RetryContext): number {
    const successRate = this.getSuccessRate();
    const baseDelay = this.config.initialDelayMs * Math.pow(2, context.attempt - 1);

    // Adjust delay based on success rate
    let adjustmentFactor = 1;
    if (successRate < 0.5) {
      // Low success rate: increase delay
      adjustmentFactor = 1 + (1 - successRate);
    } else if (successRate > 0.8) {
      // High success rate: decrease delay
      adjustmentFactor = successRate;
    }

    const adjustedDelay = baseDelay * adjustmentFactor;
    return Math.min(adjustedDelay, this.config.maxDelayMs);
  }

  isRetryableError(error: Error): boolean {
    // Same logic as other strategies
    if (this.config.nonRetryableErrors) {
      for (const pattern of this.config.nonRetryableErrors) {
        if (this.matchesPattern(error, pattern)) {
          return false;
        }
      }
    }

    if (this.config.retryableErrors) {
      for (const pattern of this.config.retryableErrors) {
        if (this.matchesPattern(error, pattern)) {
          return true;
        }
      }
      return false;
    }

    return true;
  }

  private matchesPattern(error: Error, pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') {
      return error.message.includes(pattern);
    }
    return pattern.test(error.message);
  }

  private getSuccessRate(): number {
    const totalAttempts = this.successCount + this.failureCount;
    return totalAttempts === 0 ? 0.5 : this.successCount / totalAttempts;
  }

  private recordDelay(delay: number): void {
    this.lastDelays.push(delay);
    if (this.lastDelays.length > this.maxHistorySize) {
      this.lastDelays.shift();
    }
  }

  recordSuccess(): void {
    this.successCount++;
  }

  recordFailure(): void {
    this.failureCount++;
  }

  getStats(): {
    successCount: number;
    failureCount: number;
    successRate: number;
    averageDelay: number;
  } {
    const averageDelay = this.lastDelays.length > 0
      ? this.lastDelays.reduce((sum, delay) => sum + delay, 0) / this.lastDelays.length
      : 0;

    return {
      successCount: this.successCount,
      failureCount: this.failureCount,
      successRate: this.getSuccessRate(),
      averageDelay
    };
  }

  getConfig(): RetryConfig {
    return { ...this.config };
  }

  reset(): void {
    this.successCount = 0;
    this.failureCount = 0;
    this.lastDelays = [];
  }
}

/**
 * Helper functions for creating retry strategies
 */
export const RetryStrategyFactory = {
  /**
   * Create a simple linear retry strategy
   */
  linear(config: Partial<RetryConfig> = {}): LinearRetryStrategy {
    const defaultConfig: RetryConfig = {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 5000,
      ...config
    };
    return new LinearRetryStrategy(defaultConfig);
  },

  /**
   * Create an exponential backoff strategy
   */
  exponential(config: Partial<RetryConfig> = {}): ExponentialRetryStrategy {
    const defaultConfig: RetryConfig = {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      ...config
    };
    return new ExponentialRetryStrategy(defaultConfig);
  },

  /**
   * Create a jittered exponential backoff strategy
   */
  jitteredExponential(config: Partial<RetryConfig> = {}, jitterFactor = 0.1): JitteredExponentialRetryStrategy {
    const defaultConfig: RetryConfig = {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      ...config
    };
    return new JitteredExponentialRetryStrategy(defaultConfig, jitterFactor);
  },

  /**
   * Create a circuit breaker strategy
   */
  circuitBreaker(
    config: Partial<RetryConfig> = {},
    failureThreshold = 5,
    recoveryTimeMs = 60000
  ): CircuitBreakerRetryStrategy {
    const defaultConfig: RetryConfig = {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      ...config
    };
    return new CircuitBreakerRetryStrategy(defaultConfig, failureThreshold, recoveryTimeMs);
  },

  /**
   * Create an adaptive strategy
   */
  adaptive(config: Partial<RetryConfig> = {}): AdaptiveRetryStrategy {
    const defaultConfig: RetryConfig = {
      maxAttempts: 5,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      ...config
    };
    return new AdaptiveRetryStrategy(defaultConfig);
  },

  /**
   * Create a strategy for embedder operations
   */
  forEmbedder(): ExponentialRetryStrategy {
    return RetryStrategyFactory.exponential({
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      retryableErrors: [
        'timeout',
        'connection',
        'ECONNRESET',
        'EPIPE',
        'process exited'
      ],
      nonRetryableErrors: [
        'Invalid',
        'not found',
        'permission denied'
      ]
    });
  },

  /**
   * Create a strategy for network operations
   */
  forNetwork(): JitteredExponentialRetryStrategy {
    return RetryStrategyFactory.jitteredExponential({
      maxAttempts: 5,
      initialDelayMs: 500,
      maxDelayMs: 15000,
      timeoutMs: 60000,
      retryableErrors: [
        'timeout',
        'ECONNRESET',
        'ENOTFOUND',
        'ECONNREFUSED',
        /5\d\d/ // 5xx HTTP status codes
      ]
    }, 0.2);
  },

  /**
   * Create a strategy for critical operations
   */
  forCriticalOps(): CircuitBreakerRetryStrategy {
    return RetryStrategyFactory.circuitBreaker({
      maxAttempts: 5,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 120000
    }, 3, 30000);
  }
};

/**
 * Utility class for executing operations with retry logic
 */
export class RetryExecutor {
  constructor(private strategy: RetryStrategy) {}

  /**
   * Execute an operation with retry logic
   */
  async execute<T>(
    operation: () => Promise<T>,
    operationId = `op_${Date.now()}`
  ): Promise<T> {
    let attempt = 0;
    let lastError: Error;
    const startTime = Date.now();

    while (true) {
      attempt++;

      try {
        const result = await operation();

        // Record success for adaptive strategies
        if ('recordSuccess' in this.strategy) {
          (this.strategy as any).recordSuccess();
        }

        return result;
      } catch (error: any) {
        lastError = error;

        // Record failure for adaptive strategies
        if ('recordFailure' in this.strategy) {
          (this.strategy as any).recordFailure();
        }

        const context: RetryContext = {
          attempt,
          maxAttempts: this.strategy.getConfig().maxAttempts,
          lastError,
          totalElapsed: Date.now() - startTime,
          operationId
        };

        const decision = this.strategy.shouldRetry(context);

        if (!decision.shouldRetry) {
          if (this.strategy.getConfig().onMaxAttemptsReached) {
            this.strategy.getConfig().onMaxAttemptsReached!(context);
          }
          throw lastError;
        }

        if (this.strategy.getConfig().onRetry) {
          this.strategy.getConfig().onRetry!(context);
        }

        if (decision.delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, decision.delayMs));
        }
      }
    }
  }

  /**
   * Get the current strategy
   */
  getStrategy(): RetryStrategy {
    return this.strategy;
  }

  /**
   * Change the retry strategy
   */
  setStrategy(strategy: RetryStrategy): void {
    this.strategy = strategy;
  }
};