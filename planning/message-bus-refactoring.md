# Message Bus Refactoring Plan

## Overview
Refactor inter-process communication to use a typed Message Bus pattern with supervision capabilities, making the code more testable, maintainable, and resilient while avoiding the complexity overhead of a full Actor Model.

## Problem Statement

### Current Issues
- **Timeout bugs**: Messages between workers sometimes timeout without proper handling
- **Testing difficulty**: Can't easily unit test message passing logic
- **Type safety**: Lost across process boundaries
- **Error handling**: Inconsistent across different message types
- **Memory management**: Embedder process restarts are ad-hoc
- **Debugging**: Hard to trace message flow across processes

### Current Architecture
```
Main Process <---> Worker Thread <---> Embedder Child Process
     |
     v
  Renderer
```

## Proposed Solution: Hybrid Message Bus

### Core Components

#### 1. Typed Message Definitions
```typescript
// messages/types.ts
interface MessageTypes {
  // Worker messages
  'worker.init': {
    request: { dbDir: string; userDataPath: string };
    response: { ready: boolean };
  };
  'worker.search': {
    request: { query: string; limit: number };
    response: { results: SearchResult[] };
  };
  'worker.index': {
    request: { paths: string[] };
    response: { queued: number };
  };
  'worker.stats': {
    request: {};
    response: { indexed: number; queued: number; processing: number };
  };
  
  // Embedder messages
  'embedder.embed': {
    request: { texts: string[]; isQuery: boolean };
    response: { vectors: number[][] };
  };
  'embedder.health': {
    request: {};
    response: { memory: number; processedCount: number };
  };
  
  // Model messages
  'model.check': {
    request: {};
    response: { exists: boolean; path?: string };
  };
  'model.download': {
    request: { path: string };
    response: { success: boolean; error?: string };
  };
}
```

#### 2. Message Bus Implementation
```typescript
// messages/MessageBus.ts
class MessageBus<T extends MessageTypes = MessageTypes> {
  private handlers = new Map<string, MessageHandler>();
  private pendingRequests = new Map<string, PendingRequest>();
  private middleware: Middleware[] = [];
  private transport: Transport;
  
  constructor(transport: Transport) {
    this.transport = transport;
    this.setupTransport();
  }
  
  // Register a typed handler
  handle<K extends keyof T>(
    type: K,
    handler: (payload: T[K]['request']) => Promise<T[K]['response']>
  ): void {
    this.handlers.set(type as string, handler);
  }
  
  // Send a typed message with timeout and retry
  async send<K extends keyof T>(
    type: K,
    payload: T[K]['request'],
    options: SendOptions = {}
  ): Promise<T[K]['response']> {
    const { timeout = 30000, retries = 0 } = options;
    
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.sendWithTimeout(type, payload, timeout);
      } catch (error) {
        lastError = error as Error;
        if (attempt < retries) {
          await this.delay(Math.pow(2, attempt) * 1000); // Exponential backoff
        }
      }
    }
    
    throw lastError;
  }
  
  private async sendWithTimeout<K extends keyof T>(
    type: K,
    payload: T[K]['request'],
    timeout: number
  ): Promise<T[K]['response']> {
    const id = generateId();
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new TimeoutError(`Message ${type} timed out after ${timeout}ms`));
      }, timeout);
      
      this.pendingRequests.set(id, {
        resolve,
        reject,
        timer,
        type: type as string,
        startTime: Date.now()
      });
      
      this.transport.send({
        id,
        type: type as string,
        payload
      });
    });
  }
  
  // Use middleware for cross-cutting concerns
  use(middleware: Middleware): void {
    this.middleware.push(middleware);
  }
}
```

#### 3. Transport Abstraction
```typescript
// messages/Transport.ts
interface Transport {
  send(message: Message): void;
  onMessage(handler: (message: Message) => void): void;
  close(): void;
}

// Worker Thread Transport
class WorkerTransport implements Transport {
  constructor(private worker: Worker) {}
  
  send(message: Message): void {
    this.worker.postMessage(message);
  }
  
  onMessage(handler: (message: Message) => void): void {
    this.worker.on('message', handler);
  }
  
  close(): void {
    this.worker.terminate();
  }
}

// Child Process Transport
class ChildProcessTransport implements Transport {
  constructor(private child: ChildProcess) {}
  
  send(message: Message): void {
    this.child.send(message);
  }
  
  onMessage(handler: (message: Message) => void): void {
    this.child.on('message', handler);
  }
  
  close(): void {
    this.child.kill();
  }
}

// Mock Transport for Testing
class MockTransport implements Transport {
  sentMessages: Message[] = [];
  messageHandler?: (message: Message) => void;
  
  send(message: Message): void {
    this.sentMessages.push(message);
    // Simulate async response
    if (this.mockResponses[message.type]) {
      setTimeout(() => {
        this.messageHandler?.({
          id: message.id,
          type: message.type,
          payload: this.mockResponses[message.type]
        });
      }, 0);
    }
  }
  
  onMessage(handler: (message: Message) => void): void {
    this.messageHandler = handler;
  }
}
```

#### 4. Supervision Layer
```typescript
// supervision/Supervisor.ts
class ProcessSupervisor {
  private processes = new Map<string, SupervisedProcess>();
  private restartStrategies = new Map<string, RestartStrategy>();
  
  supervise(
    id: string,
    factory: () => Process,
    strategy: RestartStrategy = RestartStrategy.EXPONENTIAL_BACKOFF
  ): SupervisedProcess {
    const process = new SupervisedProcess(id, factory, strategy);
    this.processes.set(id, process);
    process.start();
    return process;
  }
  
  async restart(id: string): Promise<void> {
    const process = this.processes.get(id);
    if (process) {
      await process.restart();
    }
  }
}

// Supervised Process
class SupervisedProcess {
  private process?: Process;
  private restartCount = 0;
  private lastRestartTime = 0;
  private bus: MessageBus;
  
  constructor(
    private id: string,
    private factory: () => Process,
    private strategy: RestartStrategy
  ) {
    this.bus = new MessageBus(new NullTransport());
  }
  
  async start(): Promise<void> {
    try {
      this.process = this.factory();
      this.bus = new MessageBus(new ChildProcessTransport(this.process));
      this.setupHealthCheck();
    } catch (error) {
      await this.handleCrash(error);
    }
  }
  
  private setupHealthCheck(): void {
    // Monitor memory and restart if needed
    setInterval(async () => {
      try {
        const health = await this.bus.send('embedder.health', {}, { timeout: 5000 });
        if (health.memory > 300_000_000 || health.processedCount > 200) {
          await this.gracefulRestart();
        }
      } catch (error) {
        // Health check failed, process might be dead
        await this.handleCrash(error);
      }
    }, 10000);
  }
  
  private async gracefulRestart(): Promise<void> {
    console.log(`Gracefully restarting ${this.id}...`);
    await this.bus.send('shutdown', {}, { timeout: 5000 }).catch(() => {});
    await this.restart();
  }
}
```

#### 5. Middleware System
```typescript
// middleware/Middleware.ts
interface Middleware {
  name: string;
  execute<T>(
    context: MiddlewareContext,
    next: () => Promise<T>
  ): Promise<T>;
}

// Logging Middleware
class LoggingMiddleware implements Middleware {
  name = 'logging';
  
  async execute<T>(context: MiddlewareContext, next: () => Promise<T>): Promise<T> {
    console.log(`[${context.type}] Starting...`);
    const startTime = Date.now();
    
    try {
      const result = await next();
      console.log(`[${context.type}] Completed in ${Date.now() - startTime}ms`);
      return result;
    } catch (error) {
      console.error(`[${context.type}] Failed:`, error);
      throw error;
    }
  }
}

// Metrics Middleware
class MetricsMiddleware implements Middleware {
  name = 'metrics';
  private metrics = new Map<string, MessageMetrics>();
  
  async execute<T>(context: MiddlewareContext, next: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await next();
      this.recordSuccess(context.type, Date.now() - startTime);
      return result;
    } catch (error) {
      this.recordFailure(context.type, Date.now() - startTime);
      throw error;
    }
  }
  
  getMetrics(type: string): MessageMetrics {
    return this.metrics.get(type) || { success: 0, failure: 0, avgTime: 0 };
  }
}
```

### Integration with Existing Code

#### Phase 1: Wrap Main-Worker Communication
```typescript
// main/WorkerBridge.ts
class WorkerBridge {
  private worker: Worker;
  private bus: MessageBus;
  private supervisor: ProcessSupervisor;
  
  async initialize(dbDir: string, userDataPath: string): Promise<void> {
    // Create worker with supervision
    this.supervisor = new ProcessSupervisor();
    this.worker = this.supervisor.supervise('worker', () => {
      return new Worker('./worker.js');
    });
    
    // Create message bus
    this.bus = new MessageBus(new WorkerTransport(this.worker));
    
    // Add middleware
    this.bus.use(new LoggingMiddleware());
    this.bus.use(new MetricsMiddleware());
    
    // Initialize worker
    await this.bus.send('worker.init', { dbDir, userDataPath });
  }
  
  async search(query: string, limit = 10): Promise<SearchResult[]> {
    const response = await this.bus.send('worker.search', { query, limit });
    return response.results;
  }
  
  async getStats(): Promise<WorkerStats> {
    return this.bus.send('worker.stats', {});
  }
}
```

#### Phase 2: Wrap Worker-Embedder Communication
```typescript
// worker/EmbedderBridge.ts
class EmbedderBridge {
  private embedder?: ChildProcess;
  private bus?: MessageBus;
  private supervisor: ProcessSupervisor;
  
  async initialize(): Promise<void> {
    this.supervisor = new ProcessSupervisor();
    
    // Supervise embedder with auto-restart
    const supervised = this.supervisor.supervise('embedder', () => {
      return fork('./embedder.js');
    }, RestartStrategy.EXPONENTIAL_BACKOFF);
    
    this.bus = supervised.getBus();
  }
  
  async embed(texts: string[], isQuery = false): Promise<number[][]> {
    if (!this.bus) throw new Error('Embedder not initialized');
    
    const response = await this.bus.send('embedder.embed', {
      texts,
      isQuery
    }, {
      timeout: 60000,
      retries: 2
    });
    
    return response.vectors;
  }
}
```

### Testing Strategy

#### Unit Tests
```typescript
// tests/WorkerBridge.test.ts
describe('WorkerBridge', () => {
  let bridge: WorkerBridge;
  let mockTransport: MockTransport;
  
  beforeEach(() => {
    mockTransport = new MockTransport();
    bridge = new WorkerBridge(mockTransport);
  });
  
  it('should handle search requests', async () => {
    // Setup mock response
    mockTransport.mockResponses['worker.search'] = {
      results: [{ id: '1', text: 'test', score: 0.9 }]
    };
    
    // Execute search
    const results = await bridge.search('test query');
    
    // Verify
    expect(results).toHaveLength(1);
    expect(mockTransport.sentMessages).toContainEqual({
      type: 'worker.search',
      payload: { query: 'test query', limit: 10 }
    });
  });
  
  it('should handle timeouts', async () => {
    // Don't set mock response - will timeout
    await expect(bridge.search('test')).rejects.toThrow(TimeoutError);
  });
  
  it('should retry on failure', async () => {
    let attempts = 0;
    mockTransport.onSend = () => {
      attempts++;
      if (attempts < 2) throw new Error('Network error');
      return { results: [] };
    };
    
    const results = await bridge.search('test', { retries: 2 });
    expect(attempts).toBe(2);
    expect(results).toEqual([]);
  });
});
```

#### Integration Tests
```typescript
// tests/integration/MessageFlow.test.ts
describe('Message Flow Integration', () => {
  let mainBridge: WorkerBridge;
  let workerBridge: EmbedderBridge;
  
  beforeAll(async () => {
    // Use real transports but with test data
    mainBridge = new WorkerBridge();
    await mainBridge.initialize('./test-db', './test-data');
  });
  
  it('should handle end-to-end search', async () => {
    const results = await mainBridge.search('test query');
    expect(results).toBeDefined();
  });
  
  it('should recover from embedder crash', async () => {
    // Simulate embedder crash
    await workerBridge.killEmbedder();
    
    // Should auto-restart and work
    const results = await mainBridge.search('test query');
    expect(results).toBeDefined();
  });
});
```

## Migration Plan

### Phase 1: Foundation (Week 1)
1. Create message type definitions
2. Implement MessageBus class
3. Implement Transport abstraction
4. Add middleware system
5. Write unit tests for MessageBus

### Phase 2: Main-Worker Integration (Week 2)
1. Create WorkerBridge wrapper
2. Update main process to use WorkerBridge
3. Keep existing worker code unchanged
4. Add logging and metrics middleware
5. Write integration tests

### Phase 3: Worker-Embedder Integration (Week 3)
1. Create EmbedderBridge wrapper
2. Add supervision for embedder process
3. Implement health checks and auto-restart
4. Update worker to use EmbedderBridge
5. Test crash recovery

### Phase 4: Cleanup (Week 4)
1. Remove old message passing code
2. Add comprehensive error handling
3. Add performance monitoring
4. Document new architecture
5. Train team on new patterns

## Benefits

### Immediate Benefits
- **Type safety**: Full TypeScript support across process boundaries
- **Testability**: Can unit test with mock transports
- **Reliability**: Built-in timeout and retry logic
- **Debugging**: Middleware for logging all messages
- **Metrics**: Track success rates and response times

### Long-term Benefits
- **Maintainability**: Clear separation of concerns
- **Extensibility**: Easy to add new message types
- **Resilience**: Automatic process supervision
- **Performance**: Can add caching middleware
- **Monitoring**: Ready for production observability

## Risks and Mitigations

### Risk: Migration Complexity
**Mitigation**: Incremental approach, keeping existing code working throughout

### Risk: Performance Overhead
**Mitigation**: Minimal overhead, can optimize with message batching if needed

### Risk: Learning Curve
**Mitigation**: Similar to existing patterns, good documentation and examples

## Success Metrics

- **Test Coverage**: >90% for message passing code
- **Timeout Errors**: Reduced by 95%
- **Mean Time to Recovery**: <5 seconds for embedder crashes
- **Developer Velocity**: 50% faster to add new message types
- **Bug Rate**: 75% reduction in message-related bugs

## Alternative Approaches Considered

1. **Full Actor Model**: Too complex for current needs
2. **Direct Function Calls**: Loses process isolation benefits
3. **gRPC/Protocol Buffers**: Overkill for local communication
4. **Event Emitters**: No type safety or timeout handling

## Conclusion

This hybrid approach provides the benefits of the Actor Model (supervision, message passing, testability) without the complexity overhead. It's a pragmatic solution that can be implemented incrementally while keeping the existing system running.