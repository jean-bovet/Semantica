# Embedder Architecture Specification

## Table of Contents
1. [Overview](#overview)
2. [Architecture & Design](#architecture--design)
3. [Core Components](#core-components)
4. [Implementation Details](#implementation-details)
5. [Testing Architecture](#testing-architecture)
6. [Operations](#operations)
7. [Evolution History](#evolution-history)

## Overview

The embedder system is a critical component of Semantica that generates vector embeddings for text chunks using the Xenova/multilingual-e5-small transformer model. It employs a multi-process architecture to ensure memory isolation, fault tolerance, and optimal performance.

### Key Features
- **Multi-process architecture** for memory isolation
- **Auto-restart mechanism** to prevent memory leaks
- **Load balancing** across multiple embedder instances
- **Fault tolerance** with automatic recovery
- **Comprehensive testing** through dependency injection

### System Role
The embedder system processes text chunks from indexed documents and generates 384-dimensional vector embeddings that enable semantic search capabilities. It runs as child processes managed by a Worker Thread, separate from the Electron main process.

## Architecture & Design

### Process Hierarchy

```
📦 Electron Application
    │
    ├─ 🔷 Main Process (Electron main window)
    │     • UI and user interaction
    │     • IPC with renderer
    │     • Spawns worker thread
    │
    └─ 🔶 Worker Thread (Node.js worker_thread)
          • File processing & queuing
          • Contains these JavaScript classes:
              - ConcurrentQueue (file processing)
              - EmbeddingQueue (chunk batching)
              - EmbedderPool (manages child processes)
              - LoadBalancer (distributes work)
              - HealthManager (monitors health)
          • Spawns and manages child processes:
          │
          ├─ 🟢 Child Process #1 (Node.js process)
          │     • Independent memory space
          │     • Runs embedder.child.ts
          │     • Communicates via IPC
          │
          └─ 🟢 Child Process #2 (Node.js process)
                • Independent memory space
                • Runs embedder.child.ts
                • Communicates via IPC
```

### Complete System Flow

```
═══════════════════════════════════════════════════════════════════════════════════════════
                        EMBEDDING SYSTEM ARCHITECTURE & FLOW
═══════════════════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                   MAIN PROCESS                                       │
│                                 (Electron Main)                                      │
└──────────────────────┬──────────────────────────────────────────────────────────────┘
                       │
                       │ spawn Worker Thread
                       ↓
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                  WORKER THREAD                                       │
│                            (src/main/worker/index.ts)                               │
│                                                                                       │
│  ┌─────────────────────────────────┐    ┌────────────────────────────────────┐     │
│  │   1. INITIALIZATION PHASE       │    │    2. EMBEDDER POOL SETUP         │     │
│  ├─────────────────────────────────┤    ├────────────────────────────────────┤     │
│  │ • initDB()                      │───→│ • Create EmbedderPool(poolSize=2)  │     │
│  │ • Load fileHashes               │    │ • Initialize LoadBalancer          │     │
│  │ • Start file watcher            │    │ • Setup HealthManager              │     │
│  │ • Check/download ML model       │    │ • Spawn child processes            │     │
│  └─────────────────────────────────┘    └──────────┬─────────────────────────┘     │
│                                                     │                                │
│  NOTE: EmbedderPool, LoadBalancer, and HealthManager are JavaScript classes         │
│  running INSIDE the Worker Thread, not separate processes                           │
│                                                     │                                │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                                     │
                    ┌────────────────────────────────┴────────────────────────────┐
                    ↓ child_process.spawn()                      ↓ child_process.spawn()
┌─────────────────────────────────────┐        ┌─────────────────────────────────────┐
│      EMBEDDER CHILD PROCESS #1      │        │      EMBEDDER CHILD PROCESS #2      │
│   (src/main/worker/embedder.child)  │        │   (src/main/worker/embedder.child)  │
│      [Separate Node.js Process]     │        │      [Separate Node.js Process]     │
│                                      │        │                                      │
│  • EmbedderCore (business logic)    │        │  • EmbedderCore (business logic)    │
│  • EmbedderIPCAdapter (messaging)  │        │  • EmbedderIPCAdapter (messaging)  │
│  • Load transformers.js model       │        │  • Load transformers.js model       │
│  • SerialQueue for processing       │        │  • SerialQueue for processing       │
│  • Memory: max 1500MB RSS           │        │  • Memory: max 1500MB RSS           │
│  • Auto-restart after 200 files     │        │  • Auto-restart after 200 files     │
└─────────────────────────────────────┘        └─────────────────────────────────────┘
```

## Core Components

### 1. EmbedderCore
The core business logic component, fully testable without external dependencies.

**Responsibilities:**
- Initialize and manage ML model
- Generate embeddings for text chunks
- Validate output vectors
- Handle memory cleanup

**Key Features:**
- No direct IPC dependencies
- Fully mockable interfaces
- Clean separation of concerns

### 2. EmbedderIPCAdapter
Handles all IPC message routing between the core logic and process communication.

**Responsibilities:**
- Route IPC messages to EmbedderCore
- Format responses for IPC protocol
- Handle process lifecycle events

### 3. EmbedderPool
Manages multiple embedder child processes for parallel processing.

**Features:**
- Configurable pool size (default: 2)
- Round-robin load balancing
- Health monitoring
- Auto-initialization

### 4. LoadBalancer
Distributes embedding requests across available embedders.

**Strategies:**
- Round-robin (default)
- Least-loaded (future)
- Failover support

### 5. HealthManager
Monitors embedder health and triggers restarts when needed.

**Monitoring:**
- Memory usage (RSS)
- Files processed count
- Response times
- Process crashes

### 6. EmbeddingQueue
Manages the queue of text chunks waiting for embedding.

**Features:**
- Batch processing (32 chunks per batch)
- Backpressure at 1000 chunks
- Retry logic (3 attempts max)
- File-level tracking

## Implementation Details

### IPC Protocol

```typescript
// Initialization
Child → Worker: { type: 'ipc-ready' }
Worker → Child: { type: 'init', model: 'Xenova/multilingual-e5-small' }
Child → Worker: { type: 'ready' } | { type: 'init:err', error: string }

// Embedding
Worker → Child: { type: 'embed', id: string, texts: string[], isQuery?: boolean }
Child → Worker: { type: 'embed:ok', id: string, vectors: number[][] }
              | { type: 'embed:err', id: string, error: string }

// Shutdown
Worker → Child: { type: 'shutdown' }
Child: process.exit(0)
```

### Memory Management

```
Restart Triggers:
├─ RSS Memory > 1500MB
├─ Files Processed > 200
└─ Process Crashed/Unresponsive

Restart Sequence:
1. Mark embedder as restarting
2. Recover in-flight batches
3. Kill child process (SIGTERM)
4. Spawn new child process
5. Re-queue lost batches
```

### Queue Configuration

```typescript
interface QueueConfig {
  capacity: 2000,           // Maximum chunks in queue
  batchSize: 32,           // Chunks per embedding batch
  backpressureThreshold: 1000, // Slow file processing
  maxConcurrentBatches: 2,  // Matches pool size
  retryAttempts: 3,        // Max retry attempts
  retryDelayMs: 1000       // Initial retry delay
}
```

### Retry Mechanism

The system implements exponential backoff for failed embedding attempts:

1. **First attempt**: Immediate
2. **First retry**: 1 second delay
3. **Second retry**: 2 seconds delay
4. **Third retry**: 4 seconds delay
5. **Failure**: Marked as failed, logged

## Testing Architecture

### Dependency Injection Structure

```typescript
// Interfaces for all external dependencies
interface IModelLoader {
  loadModel(name: string): Promise<IPipeline>;
  checkModelExists(name: string): boolean;
}

interface IPipeline {
  process(texts: string[], options: PipelineOptions): Promise<TransformerOutput>;
}

interface IProcessMessenger {
  send(message: any): void;
  onMessage(handler: (msg: any) => void): void;
  exit(code: number): void;
}
```

### Test Coverage

- **EmbedderCore**: 21 unit tests, 95%+ coverage
- **EmbedderIPCAdapter**: 22 unit tests, 90%+ coverage
- **EmbedderPool**: Integration tests, all passing
- **No process spawning** needed for unit tests
- **No ML model loading** required for tests
- **Test execution**: < 500ms

### Mock Components

```typescript
// Example mock for testing
class MockModelLoader implements IModelLoader {
  async loadModel(name: string): Promise<IPipeline> {
    return new MockPipeline();
  }

  checkModelExists(name: string): boolean {
    return true;
  }
}
```

## Operations

### Configuration

```typescript
interface EmbedderConfig {
  poolSize: number;              // Number of embedder processes (default: 2)
  maxMemoryMB: number;           // Max RSS memory per process (default: 1500)
  maxFilesBeforeRestart: number; // Files before restart (default: 200)
  batchSize: number;             // Embedding batch size (default: 32)
  modelName: string;             // ML model to use
}
```

### Monitoring

The system provides comprehensive monitoring through:

1. **Events System**
   - `embedder:initialized`
   - `embedder:restarted`
   - `state:changed`
   - `operation:started/completed`
   - `performance:metrics`

2. **Statistics API**
   ```typescript
   getStats(): {
     filesProcessed: number;
     memoryUsage: number;
     isHealthy: boolean;
     restartCount: number;
   }
   ```

3. **Health Checks**
   - Memory monitoring every 2 seconds
   - Process liveness checks
   - Response time tracking

### Troubleshooting

Common issues and solutions:

| Issue | Cause | Solution |
|-------|-------|----------|
| High memory usage | Memory leak in transformer | Auto-restart triggers at 1500MB |
| Slow embeddings | Large batch size | Reduce batch size in config |
| Process crashes | SIGTRAP in worker | Use spawn instead of fork |
| Queue overflow | Slow processing | Backpressure slows file indexing |

## Evolution History

### Phase 1: Initial Implementation
- Basic embedder in worker thread
- Single process architecture
- Memory leak issues

### Phase 2: SIGTRAP Fix (Sept 2024)
- **Problem**: SIGTRAP crashes in worker threads
- **Solution**: Moved to spawn-based child processes
- **Result**: Stable operation, better isolation

### Phase 3: Memory Management (Sept 2024)
- **Problem**: Memory leaks accumulating over time
- **Solution**: Auto-restart mechanism after 200 files or 1500MB
- **Result**: Consistent memory usage

### Phase 4: Advanced Architecture (Sept 2024)
- Introduced EmbedderPool for parallel processing
- Added LoadBalancer and HealthManager
- Implemented comprehensive retry mechanism
- Added state machine for process lifecycle

### Phase 5: Testability Refactoring (Sept 2024)
- **Problem**: Child process impossible to unit test
- **Solution**: Dependency injection and interface abstractions
- **Components Created**:
  - EmbedderCore (business logic)
  - EmbedderIPCAdapter (messaging)
  - IModelLoader, IPipeline interfaces
- **Result**: 43 unit tests with 90%+ coverage

### Future Improvements
1. Alternative ML frameworks (ONNX, TensorFlow.js)
2. Different IPC mechanisms (WebSocket, gRPC)
3. Caching layer for repeated embeddings
4. Performance telemetry
5. A/B testing different models

## Appendix

### File Structure

```
src/
├── main/worker/
│   ├── embedder.child.ts        # Thin orchestration (32 lines)
│   ├── index.ts                 # Worker thread main
│   ├── EmbeddingQueue.ts        # Queue management
│   └── ConcurrentQueue.ts       # File processing
├── shared/embeddings/
│   ├── interfaces/
│   │   ├── IModelLoader.ts      # Model loading interface
│   │   ├── IPipeline.ts         # Pipeline interface
│   │   └── IProcessMessenger.ts # IPC interface
│   ├── implementations/
│   │   ├── TransformersModelLoader.ts
│   │   └── NodeProcessMessenger.ts
│   ├── EmbedderCore.ts          # Core business logic
│   ├── EmbedderIPCAdapter.ts    # IPC adapter
│   ├── embedder-pool.ts         # Pool management
│   └── isolated.ts              # IsolatedEmbedder wrapper
└── shared/utils/
    ├── SerialQueue.ts           # Serial processing
    └── ChildProcessManager.ts   # Process management
```

### Performance Metrics

- **Embedding throughput**: ~100-200 texts/second
- **Memory per process**: 200-300MB typical, 1500MB max
- **Restart time**: ~2 seconds
- **Queue capacity**: 2000 chunks
- **Batch processing**: 32 chunks at once

---

*This specification represents the complete embedder architecture as of September 2024, incorporating all improvements from the initial implementation through the testability refactoring.*