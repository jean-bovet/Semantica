import { IsolatedEmbedder } from '../embeddings/isolated';
import { EmbedderConfig } from '../embeddings/IEmbedder';
import { EmbedderState, ProcessStateMachine } from '../utils/ProcessStateMachine';
import { EmbedderEventEmitter, createEmbedderEventEmitter } from '../embeddings/EmbedderEventEmitter';
import { RetryExecutor, RetryStrategyFactory } from '../utils/RetryStrategy';
import { EmbedderConfigValidator } from '../embeddings/EmbedderConfigValidator';

/**
 * Test configuration for embedder harness
 */
export interface TestHarnessConfig {
  modelName?: string;
  mockEmbeddings?: boolean;
  simulateErrors?: boolean;
  errorRate?: number; // 0-1
  responseDelay?: number; // milliseconds
  maxMemoryMB?: number;
  logEvents?: boolean;
  enableStateTracking?: boolean;
}

/**
 * Mock embedder that simulates the real IsolatedEmbedder for testing
 */
export class MockEmbedder {
  private state: EmbedderState = EmbedderState.Uninitialized;
  private isInitialized = false;
  private eventEmitter: EmbedderEventEmitter;
  private callCount = 0;
  private readonly config: TestHarnessConfig;
  private readonly embedderId: string;

  constructor(config: TestHarnessConfig = {}) {
    this.config = {
      modelName: 'mock-model',
      mockEmbeddings: true,
      simulateErrors: false,
      errorRate: 0.1,
      responseDelay: 10,
      maxMemoryMB: 100,
      logEvents: false,
      enableStateTracking: true,
      ...config
    };

    this.embedderId = `mock_embedder_${Math.random().toString(36).slice(2)}`;
    const eventEmitterResult = createEmbedderEventEmitter(this.embedderId);
    this.eventEmitter = eventEmitterResult.emitter;
  }

  async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    this.state = EmbedderState.Spawning;

    // Simulate initialization delay
    await new Promise(resolve => setTimeout(resolve, this.config.responseDelay));

    this.isInitialized = true;
    this.state = EmbedderState.Ready;

    if (this.config.logEvents) {
      console.log(`[MockEmbedder] Initialized: ${this.embedderId}`);
    }

    return true;
  }

  async embed(texts: string[], isQuery = false): Promise<number[][]> {
    if (!this.isInitialized) {
      throw new Error('Mock embedder not initialized');
    }

    this.callCount++;

    // Simulate response delay
    if (this.config.responseDelay) {
      await new Promise(resolve => setTimeout(resolve, this.config.responseDelay));
    }

    // Simulate errors
    if (this.config.simulateErrors && Math.random() < this.config.errorRate!) {
      throw new Error(`Simulated error (call ${this.callCount})`);
    }

    // Generate mock embeddings
    const dimension = 384;
    return texts.map(() => {
      return Array.from({ length: dimension }, () => Math.random() - 0.5);
    });
  }

  async embedWithRetry(texts: string[], isQuery = false): Promise<number[][]> {
    // Simple retry logic for mock
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        return await this.embed(texts, isQuery);
      } catch (error) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 100 * attempts));
      }
    }

    throw new Error('Mock embedder failed after retries');
  }

  async shouldRestart(): Promise<boolean> {
    return false; // Mock never needs restart
  }

  async restart(): Promise<void> {
    this.state = EmbedderState.Restarting;
    await new Promise(resolve => setTimeout(resolve, this.config.responseDelay));
    this.state = EmbedderState.Ready;

    if (this.config.logEvents) {
      console.log(`[MockEmbedder] Restarted: ${this.embedderId}`);
    }
  }

  async shutdown(): Promise<void> {
    this.state = EmbedderState.ShuttingDown;
    await new Promise(resolve => setTimeout(resolve, this.config.responseDelay! / 2));
    this.state = EmbedderState.Shutdown;
    this.isInitialized = false;

    if (this.config.logEvents) {
      console.log(`[MockEmbedder] Shutdown: ${this.embedderId}`);
    }
  }

  getStats() {
    return {
      filesSinceSpawn: this.callCount,
      isReady: this.state === EmbedderState.Ready,
      state: this.state,
      timeInCurrentState: 0,
      memoryUsage: {
        rss: 50,
        heapUsed: 30,
        external: 10
      },
      stateHistory: {
        currentState: this.state,
        timeInCurrentState: 0,
        totalTransitions: 1,
        errorCount: 0,
        restartCount: 0,
        stateDurations: {}
      }
    };
  }

  getCallCount(): number {
    return this.callCount;
  }

  getState(): EmbedderState {
    return this.state;
  }

  getEventEmitter(): EmbedderEventEmitter {
    return this.eventEmitter;
  }

  resetStats(): void {
    this.callCount = 0;
  }
}

/**
 * Test scenario for embedder testing
 */
export interface TestScenario {
  name: string;
  description: string;
  setup?: () => Promise<void> | void;
  test: (harness: EmbedderTestHarness) => Promise<void>;
  cleanup?: () => Promise<void> | void;
  expectedResults?: {
    embeddings?: number;
    errors?: number;
    restarts?: number;
    stateChanges?: string[];
  };
}

/**
 * Test results from scenario execution
 */
export interface TestResults {
  scenario: string;
  success: boolean;
  duration: number;
  embeddings: number;
  errors: number;
  events: Array<{ type: string; timestamp: number; data: any }>;
  finalState: EmbedderState;
  logs: string[];
}

/**
 * Comprehensive test harness for embedder testing with mocking,
 * event tracking, and scenario execution capabilities.
 */
export class EmbedderTestHarness {
  private embedder: IsolatedEmbedder | MockEmbedder;
  private eventHistory: Array<{ type: string; timestamp: number; data: any }> = [];
  private logs: string[] = [];
  private startTime = 0;
  private readonly config: TestHarnessConfig;
  private isUsingMock: boolean;

  constructor(config: TestHarnessConfig = {}) {
    this.config = {
      mockEmbeddings: true,
      simulateErrors: false,
      logEvents: true,
      enableStateTracking: true,
      ...config
    };

    this.isUsingMock = this.config.mockEmbeddings!;

    if (this.isUsingMock) {
      this.embedder = new MockEmbedder(this.config);
    } else {
      // Create real embedder with test configuration
      const embedderConfig: EmbedderConfig = {
        modelName: this.config.modelName || 'Xenova/multilingual-e5-small',
        maxMemoryMB: this.config.maxMemoryMB || 100,
        maxFilesBeforeRestart: 10,
        batchSize: 4
      };

      this.embedder = new IsolatedEmbedder(embedderConfig.modelName, embedderConfig);
    }

    this.setupEventTracking();
  }

  /**
   * Initialize the embedder and start tracking
   */
  async initialize(): Promise<void> {
    this.startTime = Date.now();
    this.log('Initializing embedder test harness');

    await this.embedder.initialize();
    this.log('Embedder initialized');
  }

  /**
   * Test basic embedding functionality
   */
  async testBasicEmbedding(texts: string[] = ['test text']): Promise<number[][]> {
    this.log(`Testing basic embedding with ${texts.length} texts`);

    const result = await this.embedder.embed(texts);

    this.log(`Generated ${result.length} embeddings of dimension ${result[0]?.length || 0}`);
    return result;
  }

  /**
   * Test embedding with retry logic
   */
  async testEmbeddingWithRetry(texts: string[] = ['test text'], isQuery = false): Promise<number[][]> {
    this.log(`Testing embedding with retry for ${texts.length} texts`);

    const result = await this.embedder.embedWithRetry(texts, isQuery);

    this.log(`Retry test completed, generated ${result.length} embeddings`);
    return result;
  }

  /**
   * Test error handling
   */
  async testErrorHandling(): Promise<{ errors: number; recovered: boolean }> {
    this.log('Testing error handling');

    let errors = 0;
    let recovered = false;

    // Force an error condition if using mock
    if (this.isUsingMock) {
      const mockEmbedder = this.embedder as MockEmbedder;
      const originalErrorRate = (mockEmbedder as any).config.errorRate;
      (mockEmbedder as any).config.errorRate = 1.0; // Force errors

      try {
        await this.embedder.embed(['error test']);
      } catch (error) {
        errors++;
        this.log(`Expected error caught: ${error.message}`);
      }

      // Restore normal error rate
      (mockEmbedder as any).config.errorRate = originalErrorRate;

      try {
        await this.embedder.embed(['recovery test']);
        recovered = true;
        this.log('Recovery successful');
      } catch (error) {
        this.log(`Recovery failed: ${error.message}`);
      }
    }

    return { errors, recovered };
  }

  /**
   * Test concurrent embedding operations
   */
  async testConcurrentOperations(count = 5): Promise<{ completed: number; errors: number }> {
    this.log(`Testing ${count} concurrent embedding operations`);

    const promises = Array.from({ length: count }, (_, i) =>
      this.embedder.embed([`concurrent test ${i}`]).catch(error => ({ error }))
    );

    const results = await Promise.all(promises);

    const completed = results.filter(result => !('error' in result)).length;
    const errors = results.filter(result => 'error' in result).length;

    this.log(`Concurrent test completed: ${completed} successful, ${errors} errors`);
    return { completed, errors };
  }

  /**
   * Test memory and restart scenarios
   */
  async testRestartScenario(): Promise<{ restarted: boolean; operational: boolean }> {
    this.log('Testing restart scenario');

    let restarted = false;
    let operational = false;

    try {
      const shouldRestart = await this.embedder.shouldRestart();
      this.log(`Should restart: ${shouldRestart}`);

      if (!shouldRestart) {
        // Force a restart
        await this.embedder.restart();
        restarted = true;
        this.log('Manual restart completed');
      }

      // Test that embedder is operational after restart
      await this.embedder.embed(['post-restart test']);
      operational = true;
      this.log('Post-restart operation successful');

    } catch (error) {
      this.log(`Restart test error: ${error.message}`);
    }

    return { restarted, operational };
  }

  /**
   * Run a custom test scenario
   */
  async runScenario(scenario: TestScenario): Promise<TestResults> {
    this.log(`Running scenario: ${scenario.name}`);
    const startTime = Date.now();
    let success = false;
    let embeddingCount = 0;
    let errorCount = 0;

    try {
      if (scenario.setup) {
        await scenario.setup();
      }

      // Track embeddings and errors during test
      const initialStats = this.getTestStats();

      await scenario.test(this);

      const finalStats = this.getTestStats();
      embeddingCount = finalStats.totalEmbeddings - initialStats.totalEmbeddings;
      errorCount = finalStats.totalErrors - initialStats.totalErrors;

      success = true;
      this.log(`Scenario ${scenario.name} completed successfully`);

    } catch (error: any) {
      errorCount++;
      this.log(`Scenario ${scenario.name} failed: ${error.message}`);

    } finally {
      if (scenario.cleanup) {
        await scenario.cleanup();
      }
    }

    const duration = Date.now() - startTime;
    const finalState = this.isUsingMock ?
      (this.embedder as MockEmbedder).getState() :
      EmbedderState.Ready; // Assume ready for real embedder

    return {
      scenario: scenario.name,
      success,
      duration,
      embeddings: embeddingCount,
      errors: errorCount,
      events: [...this.eventHistory],
      finalState,
      logs: [...this.logs]
    };
  }

  /**
   * Validate embedder configuration
   */
  validateConfiguration(config: Partial<EmbedderConfig>): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const validator = new EmbedderConfigValidator('test');
    const result = validator.validate(config);

    this.log(`Configuration validation: ${result.isValid ? 'PASS' : 'FAIL'}`);
    if (result.errors.length > 0) {
      this.log(`Errors: ${result.errors.join(', ')}`);
    }
    if (result.warnings.length > 0) {
      this.log(`Warnings: ${result.warnings.join(', ')}`);
    }

    return {
      isValid: result.isValid,
      errors: result.errors,
      warnings: result.warnings
    };
  }

  /**
   * Get comprehensive test statistics
   */
  getTestStats(): {
    totalEmbeddings: number;
    totalErrors: number;
    eventCount: number;
    duration: number;
    state: EmbedderState;
    memoryUsage?: any;
  } {
    const embeddings = this.eventHistory.filter(e => e.type === 'embed_completed').length;
    const errors = this.eventHistory.filter(e => e.type === 'embed_error').length;
    const stats = this.embedder.getStats();

    return {
      totalEmbeddings: embeddings,
      totalErrors: errors,
      eventCount: this.eventHistory.length,
      duration: Date.now() - this.startTime,
      state: this.isUsingMock ? (this.embedder as MockEmbedder).getState() : EmbedderState.Ready,
      memoryUsage: stats.memoryUsage
    };
  }

  /**
   * Get event history filtered by type
   */
  getEventHistory(eventType?: string): Array<{ type: string; timestamp: number; data: any }> {
    if (eventType) {
      return this.eventHistory.filter(e => e.type === eventType);
    }
    return [...this.eventHistory];
  }

  /**
   * Get all log entries
   */
  getLogs(): string[] {
    return [...this.logs];
  }

  /**
   * Reset all tracking data
   */
  reset(): void {
    this.eventHistory = [];
    this.logs = [];
    this.startTime = Date.now();

    if (this.isUsingMock) {
      (this.embedder as MockEmbedder).resetStats();
    }

    this.log('Test harness reset');
  }

  /**
   * Cleanup and shutdown
   */
  async cleanup(): Promise<void> {
    this.log('Cleaning up test harness');

    try {
      await this.embedder.shutdown();
      this.log('Embedder shutdown completed');
    } catch (error: any) {
      this.log(`Cleanup error: ${error.message}`);
    }
  }

  /**
   * Get the underlying embedder (for advanced testing)
   */
  getEmbedder(): IsolatedEmbedder | MockEmbedder {
    return this.embedder;
  }

  /**
   * Check if using mock embedder
   */
  isMockEmbedder(): boolean {
    return this.isUsingMock;
  }

  /**
   * Set up event tracking for embedder operations
   */
  private setupEventTracking(): void {
    if (!this.config.enableStateTracking) {
      return;
    }

    // Track embedder events if available
    if (this.isUsingMock) {
      const mockEmbedder = this.embedder as MockEmbedder;
      const eventEmitter = mockEmbedder.getEventEmitter();

      eventEmitter.on('embedder:initialized', () => {
        this.trackEvent('embedder_initialized', {});
      });

      eventEmitter.on('state:changed', (embedderId, from, to, reason) => {
        this.trackEvent('state_changed', { from, to, reason });
      });
    }

    // Override embedder methods to track calls
    const originalEmbed = this.embedder.embed.bind(this.embedder);
    this.embedder.embed = async (texts: string[], isQuery = false) => {
      this.trackEvent('embed_started', { textCount: texts.length, isQuery });

      try {
        const result = await originalEmbed(texts, isQuery);
        this.trackEvent('embed_completed', { textCount: texts.length, vectorCount: result.length });
        return result;
      } catch (error: any) {
        this.trackEvent('embed_error', { error: error.message, textCount: texts.length });
        throw error;
      }
    };
  }

  /**
   * Track an event with timestamp
   */
  private trackEvent(type: string, data: any): void {
    this.eventHistory.push({
      type,
      timestamp: Date.now(),
      data
    });

    if (this.config.logEvents) {
      this.log(`Event: ${type} - ${JSON.stringify(data)}`);
    }
  }

  /**
   * Add a log entry with timestamp
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    this.logs.push(logEntry);

    if (this.config.logEvents) {
      console.log(`[TestHarness] ${logEntry}`);
    }
  }
}

/**
 * Helper functions for creating test scenarios
 */
export const TestScenarios = {
  /**
   * Basic functionality test
   */
  basicFunctionality(): TestScenario {
    return {
      name: 'basic_functionality',
      description: 'Test basic embedding functionality',
      test: async (harness) => {
        await harness.testBasicEmbedding(['hello world']);
        await harness.testBasicEmbedding(['test', 'multiple', 'texts']);
      },
      expectedResults: {
        embeddings: 2,
        errors: 0
      }
    };
  },

  /**
   * Error handling test
   */
  errorHandling(): TestScenario {
    return {
      name: 'error_handling',
      description: 'Test error handling and recovery',
      test: async (harness) => {
        const result = await harness.testErrorHandling();
        if (!result.recovered) {
          throw new Error('Failed to recover from error');
        }
      }
    };
  },

  /**
   * Concurrent operations test
   */
  concurrentOperations(): TestScenario {
    return {
      name: 'concurrent_operations',
      description: 'Test concurrent embedding operations',
      test: async (harness) => {
        const result = await harness.testConcurrentOperations(10);
        if (result.completed < 8) {
          throw new Error(`Too many failures: ${result.errors}/${result.completed + result.errors}`);
        }
      }
    };
  },

  /**
   * Performance stress test
   */
  performanceStress(): TestScenario {
    return {
      name: 'performance_stress',
      description: 'Test performance under stress',
      test: async (harness) => {
        const startTime = Date.now();

        for (let i = 0; i < 50; i++) {
          await harness.testBasicEmbedding([`stress test ${i}`]);
        }

        const duration = Date.now() - startTime;
        if (duration > 30000) { // 30 seconds
          throw new Error(`Performance test too slow: ${duration}ms`);
        }
      },
      expectedResults: {
        embeddings: 50,
        errors: 0
      }
    };
  }
};

/**
 * Factory for creating test harnesses with common configurations
 */
export const TestHarnessFactory = {
  /**
   * Create a mock-based test harness (fast, no dependencies)
   */
  createMock(config: Partial<TestHarnessConfig> = {}): EmbedderTestHarness {
    return new EmbedderTestHarness({
      mockEmbeddings: true,
      simulateErrors: false,
      responseDelay: 1,
      logEvents: false,
      ...config
    });
  },

  /**
   * Create a real embedder test harness (slower, requires model)
   */
  createReal(config: Partial<TestHarnessConfig> = {}): EmbedderTestHarness {
    return new EmbedderTestHarness({
      mockEmbeddings: false,
      logEvents: true,
      ...config
    });
  },

  /**
   * Create a harness for error simulation
   */
  createErrorSimulation(errorRate = 0.3): EmbedderTestHarness {
    return new EmbedderTestHarness({
      mockEmbeddings: true,
      simulateErrors: true,
      errorRate,
      responseDelay: 10,
      logEvents: true
    });
  },

  /**
   * Create a harness for performance testing
   */
  createPerformanceTest(): EmbedderTestHarness {
    return new EmbedderTestHarness({
      mockEmbeddings: true,
      simulateErrors: false,
      responseDelay: 1,
      logEvents: false,
      enableStateTracking: false
    });
  }
};