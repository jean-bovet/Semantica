# Embedder Child Process Testability Refactoring Plan

## Overview
This document outlines a comprehensive refactoring plan to improve the testability of the embedder child process (`embedder.child.ts`) by introducing dependency injection, separation of concerns, and proper abstractions.

## Current State Analysis

### Problems Identified

1. **NO DIRECT UNIT TESTS**: The child process has zero direct unit test coverage
2. **Only indirect testing** through:
   - `embedder-child-serial.spec.ts` - tests serial queue behavior but mocks everything
   - `embedder-pool.spec.ts` - tests pool management with mocked child processes
3. **Tight coupling** to:
   - `process` global object (IPC communication)
   - `@xenova/transformers` library (ML model)
   - File system operations for model loading

### Key Testability Issues

1. **Global Dependencies**:
   - Direct use of `process.send()` and `process.on('message')`
   - Direct `process.exit()` calls
   - Global `transformers` and `pipe` variables

2. **Mixed Responsibilities**:
   - IPC communication logic mixed with business logic
   - Model initialization mixed with message handling
   - No dependency injection

3. **Hard to Mock**:
   - Can't easily test without spawning actual child process
   - Can't test embedding logic without loading real ML model
   - Can't test message handling without IPC setup

## Proposed Architecture

### Component Diagram
```
┌─────────────────────────────────────────────────────────────┐
│                     embedder.child.ts                       │
│                    (Thin orchestration layer)               │
└──────────────────────────┬──────────────────────────────────┘
                           │ uses
        ┌──────────────────┴──────────────────┐
        │                                      │
        ▼                                      ▼
┌──────────────────────┐          ┌──────────────────────────┐
│  EmbedderIPCAdapter  │          │   NodeProcessMessenger   │
│  (Message routing)   │          │   (IPC implementation)   │
└──────────┬───────────┘          └──────────────────────────┘
           │ uses
           ▼
┌──────────────────────┐
│    EmbedderCore      │ ← Core business logic (fully testable)
│  (Embedding logic)   │
└──────────┬───────────┘
           │ uses
           ▼
┌───────────────────────────────────────────────┐
│              Dependencies                      │
│  ┌─────────────────┐  ┌──────────────────┐   │
│  │  IModelLoader   │  │ EmbeddingProcessor│   │
│  │  (abstraction)  │  │   (existing)      │   │
│  └─────────────────┘  └──────────────────┘   │
│  ┌─────────────────┐  ┌──────────────────┐   │
│  │  SerialQueue    │  │ ModelPathResolver │   │
│  │   (existing)    │  │   (existing)      │   │
│  └─────────────────┘  └──────────────────┘   │
└───────────────────────────────────────────────┘
```

## Refactoring Components

### 1. Core Business Logic Extraction

#### EmbedderCore Class
```typescript
// src/shared/embeddings/EmbedderCore.ts
export interface EmbedderCoreConfig {
  defaultDimension?: number;
  modelName?: string;
}

export class EmbedderCore {
  private pipeline: IPipeline | null = null;
  private initialized = false;

  constructor(
    private modelLoader: IModelLoader,
    private processor: EmbeddingProcessor,
    private queue: SerialQueue,
    private config: EmbedderCoreConfig = {}
  ) {}

  async initialize(modelName: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Load the model through abstraction
    this.pipeline = await this.modelLoader.loadModel(modelName);
    this.initialized = true;
  }

  async embed(texts: string[], isQuery: boolean): Promise<number[][]> {
    if (!this.initialized || !this.pipeline) {
      throw new Error('EmbedderCore not initialized');
    }

    return this.queue.add(async () => {
      const prefixedTexts = this.processor.addPrefixes(texts, isQuery);
      const output = await this.pipeline.process(prefixedTexts, {
        pooling: 'mean',
        normalize: true
      });

      const { vectors } = this.processor.processEmbedding(texts, output, isQuery);
      this.processor.cleanup(output);

      return vectors;
    });
  }

  async checkModel(modelName: string): Promise<boolean> {
    return this.modelLoader.checkModelExists(modelName);
  }

  shutdown(): void {
    this.queue.shutdown();
    this.initialized = false;
    this.pipeline = null;
  }
}
```

### 2. Abstractions for External Dependencies

#### Interfaces
```typescript
// src/shared/embeddings/interfaces/IModelLoader.ts
export interface IModelLoader {
  loadModel(name: string): Promise<IPipeline>;
  checkModelExists(name: string): boolean;
  getModelInfo(name: string): ModelInfo;
}

// src/shared/embeddings/interfaces/IProcessMessenger.ts
export interface IProcessMessenger {
  send(message: any): void;
  onMessage(handler: (msg: any) => void): void;
  onDisconnect(handler: () => void): void;
  exit(code: number): void;
}

// src/shared/embeddings/interfaces/IPipeline.ts
export interface IPipeline {
  process(texts: string[], options: PipelineOptions): Promise<TransformerOutput>;
}

export interface PipelineOptions {
  pooling?: 'mean' | 'max' | 'cls';
  normalize?: boolean;
}
```

### 3. IPC Adapter Pattern

#### EmbedderIPCAdapter
```typescript
// src/shared/embeddings/EmbedderIPCAdapter.ts
export class EmbedderIPCAdapter {
  private router: IPCMessageRouter;

  constructor(
    private core: EmbedderCore,
    private messenger: IProcessMessenger
  ) {
    this.router = new IPCMessageRouter();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.router.on('check-model', async () => {
      try {
        const exists = await this.core.checkModel();
        const response = IPCMessageBuilder.modelStatus(exists);
        this.messenger.send(response);
      } catch (e: any) {
        const response = IPCMessageBuilder.modelStatus(false, String(e));
        this.messenger.send(response);
      }
    });

    this.router.on('init', async (msg) => {
      if (!MessageTypeGuards.isInitMessage(msg)) return;

      try {
        await this.core.initialize(msg.model || 'Xenova/multilingual-e5-small');
        const response = IPCMessageBuilder.ready();
        this.messenger.send(response);
      } catch (e: any) {
        const response = IPCMessageBuilder.initError(e);
        this.messenger.send(response);
      }
    });

    this.router.on('embed', async (msg) => {
      if (!MessageTypeGuards.isEmbedMessage(msg)) return;

      try {
        const vectors = await this.core.embed(msg.texts, msg.isQuery || false);
        const response = IPCMessageBuilder.embedSuccess(msg.id, vectors);
        this.messenger.send(response);
      } catch (e: any) {
        const response = IPCMessageBuilder.embedError(msg.id, e);
        this.messenger.send(response);
      }
    });

    this.router.on('shutdown', () => {
      this.core.shutdown();
      this.messenger.exit(0);
    });
  }

  start(): void {
    // Set up message handling
    this.messenger.onMessage(async (msg) => {
      const handled = await this.router.route(msg);
      if (!handled) {
        console.warn('[EMBEDDER] Unhandled message type:', msg?.type);
      }
    });

    // Handle parent disconnect
    this.messenger.onDisconnect(() => {
      this.messenger.exit(0);
    });

    // Signal ready for IPC
    this.messenger.send({ type: 'ipc-ready' });
  }
}
```

### 4. Concrete Implementations

#### TransformersModelLoader
```typescript
// src/shared/embeddings/implementations/TransformersModelLoader.ts
export class TransformersModelLoader implements IModelLoader {
  private transformers: any = null;
  private pathResolver: ModelPathResolver;

  constructor(pathResolver?: ModelPathResolver) {
    this.pathResolver = pathResolver || new ModelPathResolver();
  }

  async loadModel(name: string): Promise<IPipeline> {
    await this.initTransformers();

    const pipeline = await this.transformers.pipeline(
      'feature-extraction',
      name,
      { quantized: true }
    );

    return {
      process: async (texts: string[], options: PipelineOptions) => {
        return await pipeline(texts, options);
      }
    };
  }

  checkModelExists(name: string): boolean {
    const modelInfo = this.pathResolver.getModelInfo(name);
    return modelInfo.exists;
  }

  private async initTransformers(): Promise<void> {
    if (!this.transformers) {
      this.transformers = await import('@xenova/transformers');
      const resolved = this.pathResolver.resolve();

      this.transformers.env.localModelPath = resolved.localModelPath;
      this.transformers.env.cacheDir = resolved.cacheDir;
      this.transformers.env.allowRemoteModels = resolved.allowRemoteModels;
    }
  }
}
```

#### NodeProcessMessenger
```typescript
// src/shared/embeddings/implementations/NodeProcessMessenger.ts
export class NodeProcessMessenger implements IProcessMessenger {
  constructor(private process: NodeJS.Process) {}

  send(message: any): void {
    if (this.process.send) {
      this.process.send(message);
    }
  }

  onMessage(handler: (msg: any) => void): void {
    this.process.on('message', handler);
  }

  onDisconnect(handler: () => void): void {
    this.process.on('disconnect', handler);
  }

  exit(code: number): void {
    this.process.exit(code);
  }
}
```

### 5. Refactored embedder.child.ts

```typescript
// src/main/worker/embedder.child.ts - Minimal orchestration
import { EmbedderCore } from '../../shared/embeddings/EmbedderCore';
import { EmbedderIPCAdapter } from '../../shared/embeddings/EmbedderIPCAdapter';
import { TransformersModelLoader } from '../../shared/embeddings/implementations/TransformersModelLoader';
import { NodeProcessMessenger } from '../../shared/embeddings/implementations/NodeProcessMessenger';
import { EmbeddingProcessor } from '../../shared/embeddings/EmbeddingProcessor';
import { SerialQueue } from '../../shared/utils/SerialQueue';
import { ModelPathResolver } from '../../shared/embeddings/ModelPathResolver';

// Wire up dependencies
const pathResolver = new ModelPathResolver();
const modelLoader = new TransformersModelLoader(pathResolver);
const processor = new EmbeddingProcessor();
const queue = new SerialQueue();

// Create core business logic
const core = new EmbedderCore(modelLoader, processor, queue);

// Create IPC adapter
const messenger = new NodeProcessMessenger(process);
const adapter = new EmbedderIPCAdapter(core, messenger);

// Start the embedder
adapter.start();
```

## Testing Strategy

### 1. Unit Tests for EmbedderCore

```typescript
// tests/unit/embedder-core.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { EmbedderCore } from '@/shared/embeddings/EmbedderCore';

describe('EmbedderCore', () => {
  let core: EmbedderCore;
  let mockModelLoader: IModelLoader;
  let mockProcessor: EmbeddingProcessor;
  let mockQueue: SerialQueue;

  beforeEach(() => {
    mockModelLoader = {
      loadModel: vi.fn().mockResolvedValue({
        process: vi.fn().mockResolvedValue({
          data: new Float32Array(384),
          dims: [1, 384]
        })
      }),
      checkModelExists: vi.fn().mockReturnValue(true)
    };

    mockProcessor = {
      addPrefixes: vi.fn().mockImplementation((texts) => texts),
      processEmbedding: vi.fn().mockReturnValue({
        vectors: [[0.1, 0.2, 0.3]],
        processedTexts: ['test']
      }),
      cleanup: vi.fn()
    };

    mockQueue = new SerialQueue();
    core = new EmbedderCore(mockModelLoader, mockProcessor, mockQueue);
  });

  it('should initialize model', async () => {
    await core.initialize('test-model');
    expect(mockModelLoader.loadModel).toHaveBeenCalledWith('test-model');
  });

  it('should process embeddings', async () => {
    await core.initialize('test-model');
    const vectors = await core.embed(['test text'], false);

    expect(mockProcessor.addPrefixes).toHaveBeenCalledWith(['test text'], false);
    expect(vectors).toEqual([[0.1, 0.2, 0.3]]);
  });

  it('should throw if not initialized', async () => {
    await expect(core.embed(['test'], false)).rejects.toThrow('EmbedderCore not initialized');
  });

  it('should handle query embeddings', async () => {
    await core.initialize('test-model');
    await core.embed(['query text'], true);

    expect(mockProcessor.addPrefixes).toHaveBeenCalledWith(['query text'], true);
  });
});
```

### 2. Unit Tests for IPC Adapter

```typescript
// tests/unit/embedder-ipc-adapter.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { EmbedderIPCAdapter } from '@/shared/embeddings/EmbedderIPCAdapter';

describe('EmbedderIPCAdapter', () => {
  let adapter: EmbedderIPCAdapter;
  let mockCore: EmbedderCore;
  let mockMessenger: IProcessMessenger;

  beforeEach(() => {
    mockCore = {
      initialize: vi.fn().mockResolvedValue(undefined),
      embed: vi.fn().mockResolvedValue([[0.1, 0.2]]),
      checkModel: vi.fn().mockResolvedValue(true),
      shutdown: vi.fn()
    };

    mockMessenger = {
      send: vi.fn(),
      onMessage: vi.fn(),
      onDisconnect: vi.fn(),
      exit: vi.fn()
    };

    adapter = new EmbedderIPCAdapter(mockCore, mockMessenger);
  });

  it('should route init message to core', async () => {
    const handler = mockMessenger.onMessage.mock.calls[0][0];
    await handler({ type: 'init', model: 'test-model' });

    expect(mockCore.initialize).toHaveBeenCalledWith('test-model');
    expect(mockMessenger.send).toHaveBeenCalledWith({ type: 'ready' });
  });

  it('should route embed message to core', async () => {
    const handler = mockMessenger.onMessage.mock.calls[0][0];
    await handler({
      type: 'embed',
      id: 'test-id',
      texts: ['test'],
      isQuery: false
    });

    expect(mockCore.embed).toHaveBeenCalledWith(['test'], false);
    expect(mockMessenger.send).toHaveBeenCalledWith({
      type: 'embed:ok',
      id: 'test-id',
      vectors: [[0.1, 0.2]]
    });
  });

  it('should handle shutdown message', async () => {
    const handler = mockMessenger.onMessage.mock.calls[0][0];
    await handler({ type: 'shutdown' });

    expect(mockCore.shutdown).toHaveBeenCalled();
    expect(mockMessenger.exit).toHaveBeenCalledWith(0);
  });
});
```

### 3. Integration Tests

```typescript
// tests/integration/embedder-child-integration.spec.ts
describe('Embedder Child Integration', () => {
  it('should process end-to-end embedding request', async () => {
    // Test with mock implementations but real wiring
    const core = new EmbedderCore(
      new MockModelLoader(),
      new EmbeddingProcessor(),
      new SerialQueue()
    );

    const messenger = new MockProcessMessenger();
    const adapter = new EmbedderIPCAdapter(core, messenger);

    adapter.start();

    // Simulate init message
    await messenger.simulateMessage({ type: 'init', model: 'test' });
    expect(messenger.sentMessages).toContainEqual({ type: 'ready' });

    // Simulate embed message
    await messenger.simulateMessage({
      type: 'embed',
      id: '123',
      texts: ['test text'],
      isQuery: false
    });

    expect(messenger.sentMessages).toContainEqual({
      type: 'embed:ok',
      id: '123',
      vectors: expect.any(Array)
    });
  });
});
```

## Implementation Plan

### Phase 1: Create Abstractions (Week 1)
1. Define interfaces (`IModelLoader`, `IProcessMessenger`, `IPipeline`)
2. Create abstract base classes if needed
3. Document interface contracts

### Phase 2: Extract Core Logic (Week 1)
1. Create `EmbedderCore` class
2. Move embedding logic from `embedder.child.ts`
3. Write comprehensive unit tests for `EmbedderCore`

### Phase 3: Implement Adapters (Week 2)
1. Create `EmbedderIPCAdapter`
2. Implement `TransformersModelLoader`
3. Implement `NodeProcessMessenger`
4. Write unit tests for each adapter

### Phase 4: Refactor Child Process (Week 2)
1. Update `embedder.child.ts` to use new components
2. Ensure backward compatibility
3. Run integration tests

### Phase 5: Testing & Documentation (Week 3)
1. Write comprehensive unit tests (target 95% coverage)
2. Write integration tests
3. Update documentation
4. Performance testing

## Success Metrics

### Test Coverage Goals
- **EmbedderCore**: 95%+ coverage (core business logic)
- **EmbedderIPCAdapter**: 90%+ coverage (message routing)
- **ModelLoader**: 85%+ coverage (with mocked transformers)
- **ProcessMessenger**: 90%+ coverage (IPC abstraction)
- **Integration**: 80%+ coverage (full stack with mocks)

### Quality Metrics
- Zero direct dependencies on global objects in core logic
- All external dependencies behind interfaces
- Each component independently testable
- No need to spawn processes for unit tests
- No need to load ML models for unit tests

## Benefits

1. **Unit Testable**: Core logic can be tested without spawning processes or loading models
2. **Mockable Dependencies**: All external dependencies are behind interfaces
3. **Separation of Concerns**: IPC, model loading, and embedding logic are separate
4. **Reusable Components**: `EmbedderCore` could be used in other contexts (e.g., direct API)
5. **Better Error Handling**: Each layer can handle its specific errors
6. **Easier Debugging**: Can test each component in isolation
7. **Maintainability**: Clear boundaries between components
8. **Documentation**: Interfaces serve as contracts

## Migration Strategy

### Backward Compatibility
- Keep existing `embedder.child.ts` working during migration
- Use feature flags if needed for gradual rollout
- Ensure all existing tests continue to pass

### Risk Mitigation
- Create new files rather than modifying existing ones initially
- Run both old and new implementations in parallel for validation
- Comprehensive integration tests before switching

## Future Enhancements

Once this refactoring is complete, we can easily add:
1. Alternative model loaders (e.g., ONNX, TensorFlow.js)
2. Different IPC mechanisms (e.g., WebSockets, gRPC)
3. Caching layers for embeddings
4. Performance monitoring and metrics
5. A/B testing of different models
6. Direct API usage without IPC

## Conclusion

This refactoring will transform the embedder child process from a monolithic, hard-to-test component into a modular, testable, and maintainable system. The investment in proper architecture will pay dividends in:
- Reduced debugging time
- Faster feature development
- Better reliability
- Easier onboarding for new developers
- Confidence in changes through comprehensive tests