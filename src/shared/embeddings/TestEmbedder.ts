import { IEmbedder } from './IEmbedder';

/**
 * Test implementation of IEmbedder for unit testing
 * Provides predictable, controllable behavior for tests
 */
export class TestEmbedder implements IEmbedder {
  private _isReady = false;
  private _filesSinceSpawn = 0;
  private _shouldFail = false;
  private _failureCount = 0;
  private _embedDelay = 0;
  private _memoryUsage = { rss: 100, heapUsed: 50, external: 20 };
  private _shouldRestartFlag = false;
  private _initializeCallCount = 0;
  private _shutdownCallCount = 0;
  private _restartCallCount = 0;
  
  // Test control methods
  setShouldFail(shouldFail: boolean) {
    this._shouldFail = shouldFail;
  }
  
  setEmbedDelay(ms: number) {
    this._embedDelay = ms;
  }
  
  setMemoryUsage(usage: { rss: number; heapUsed: number; external: number }) {
    this._memoryUsage = usage;
  }
  
  setShouldRestart(should: boolean) {
    this._shouldRestartFlag = should;
  }
  
  getCallCounts() {
    return {
      initialize: this._initializeCallCount,
      shutdown: this._shutdownCallCount,
      restart: this._restartCallCount,
      failures: this._failureCount
    };
  }
  
  reset() {
    this._isReady = false;
    this._filesSinceSpawn = 0;
    this._shouldFail = false;
    this._failureCount = 0;
    this._embedDelay = 0;
    this._memoryUsage = { rss: 100, heapUsed: 50, external: 20 };
    this._shouldRestartFlag = false;
    this._initializeCallCount = 0;
    this._shutdownCallCount = 0;
    this._restartCallCount = 0;
  }
  
  // IEmbedder implementation
  async initialize(): Promise<boolean> {
    this._initializeCallCount++;
    
    // Simulate initialization delay
    await new Promise(r => setTimeout(r, 10));
    
    this._isReady = true;
    return true;
  }
  
  async embed(texts: string[]): Promise<number[][]> {
    if (!this._isReady) {
      throw new Error('Embedder not initialized');
    }
    
    if (this._shouldFail) {
      this._failureCount++;
      throw new Error('Test embedding failure');
    }
    
    // Simulate processing delay
    if (this._embedDelay > 0) {
      await new Promise(r => setTimeout(r, this._embedDelay));
    }
    
    this._filesSinceSpawn++;
    
    // Return mock embeddings (384-dimensional vectors)
    return texts.map(() => {
      const vector = new Array(384).fill(0);
      // Add some variation to make vectors different
      for (let i = 0; i < 10; i++) {
        vector[i] = Math.random();
      }
      return vector;
    });
  }
  
  async embedWithRetry(texts: string[], maxRetries = 3): Promise<number[][]> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.embed(texts);
      } catch (error: any) {
        lastError = error;
        
        if (attempt < maxRetries - 1) {
          // Simulate retry delay
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
          
          // On second retry, stop failing if configured
          if (attempt === 1 && this._shouldFail) {
            this._shouldFail = false; // Succeed on third attempt
          }
        }
      }
    }
    
    throw lastError || new Error('All retries failed');
  }
  
  async shouldRestart(): Promise<boolean> {
    return this._shouldRestartFlag || this._filesSinceSpawn > 100;
  }
  
  async restart(): Promise<void> {
    this._restartCallCount++;
    await this.shutdown();
    await this.initialize();
    this._filesSinceSpawn = 0;
  }
  
  async shutdown(): Promise<void> {
    this._shutdownCallCount++;
    this._isReady = false;
    // Simulate cleanup delay
    await new Promise(r => setTimeout(r, 5));
  }
  
  getStats() {
    return {
      filesSinceSpawn: this._filesSinceSpawn,
      isReady: this._isReady,
      memoryUsage: this._memoryUsage
    };
  }
}

/**
 * Factory function to create test embedder with specific behavior
 */
export function createTestEmbedder(options?: {
  shouldFail?: boolean;
  embedDelay?: number;
  shouldRestart?: boolean;
}): TestEmbedder {
  const embedder = new TestEmbedder();
  
  if (options?.shouldFail) embedder.setShouldFail(true);
  if (options?.embedDelay) embedder.setEmbedDelay(options.embedDelay);
  if (options?.shouldRestart) embedder.setShouldRestart(true);
  
  return embedder;
}