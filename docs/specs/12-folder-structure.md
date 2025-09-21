# Folder Structure

*Previous: [11-performance-architecture.md](./11-performance-architecture.md)*

---

## Overview

The Semantica codebase follows a domain-driven design pattern, organizing code by business domain rather than technical layers. This structure improves code discoverability, maintainability, and enforces clear boundaries between different parts of the application.

## Directory Structure

```
semantica/
├── src/
│   ├── main/                     # Electron main process
│   │   ├── core/                 # Core business logic (domain-driven)
│   │   │   ├── indexing/         # File indexing domain
│   │   │   ├── embedding/        # Embedding generation domain
│   │   │   └── reindex/          # Re-indexing domain
│   │   ├── services/             # Application services layer
│   │   ├── worker/               # Worker thread entry point
│   │   ├── parsers/              # File format parsers
│   │   ├── startup/              # Application startup coordination
│   │   ├── pipeline/             # Processing pipeline utilities
│   │   ├── utils/                # Main process utilities
│   │   ├── main.ts               # Main process entry point
│   │   └── preload.ts            # Preload script for renderer
│   │
│   ├── renderer/                  # React UI application
│   │   ├── components/           # React components
│   │   ├── contexts/             # React contexts
│   │   ├── hooks/                # Custom React hooks
│   │   ├── utils/                # UI utilities
│   │   ├── App.tsx               # Root component
│   │   └── main.tsx              # Renderer entry point
│   │
│   └── shared/                    # Shared between processes
│       ├── embeddings/           # Embedder implementations
│       ├── utils/                # Shared utilities
│       └── test-utils/           # Test utilities
│
├── tests/
│   ├── unit/                     # Unit tests
│   ├── integration/              # Integration tests
│   ├── e2e/                      # End-to-end tests
│   ├── fixtures/                 # Test fixtures
│   ├── helpers/                  # Test helpers
│   └── mocks/                    # Test mocks
│
├── docs/
│   ├── specs/                    # System specifications
│   ├── guides/                   # How-to guides
│   ├── analysis/                 # Research and analysis
│   └── planning/                 # Future plans (at root)
│
├── resources/                    # Application resources
├── build/                        # Build configuration
├── dist/                         # Build output
└── releases/                     # Release notes
```

## Core Domain Organization

### `src/main/core/`

The core directory contains the business logic organized by domain:

#### `indexing/` - File Indexing Domain
Handles discovering, scanning, and tracking files for indexing.

- **`fileScanner.ts`**: Main file processing pipeline
  - Scans directories for supported files
  - Queues files for processing
  - Manages processing state

- **`fileStatusManager.ts`**: File status tracking
  - Tracks indexing status (indexed, failed, queued, outdated)
  - Manages file hashes for change detection
  - Handles status persistence in database

- **`directoryScanner.ts`**: Directory traversal
  - Recursively scans directories
  - Applies inclusion/exclusion patterns
  - Handles file system permissions

#### `embedding/` - Embedding Generation Domain
Manages the queue and processing of text embeddings.

- **`EmbeddingQueue.ts`**: Work queue management
  - Batches chunks for efficient processing
  - Implements backpressure control
  - Manages concurrent processing

- **`ConcurrentQueue.ts`**: Concurrent processing
  - Handles parallel batch processing
  - Manages worker pool distribution
  - Implements queue prioritization

- **`PerformanceProfiler.ts`**: Performance monitoring
  - Tracks processing metrics
  - Identifies bottlenecks
  - Generates performance reports

#### `reindex/` - Re-indexing Domain
Handles file updates and folder management.

- **`reindexManager.ts`**: Re-index decision logic
  - Determines when files need re-indexing
  - Tracks parser version changes
  - Manages file modification detection

- **`ReindexOrchestrator.ts`**: Re-index coordination
  - Orchestrates full re-indexing operations
  - Manages progress tracking
  - Handles error recovery

- **`FolderRemovalManager.ts`**: Folder removal
  - Removes folders from index
  - Cleans up orphaned entries
  - Updates file status records

## Services Layer

### `src/main/services/`

Application services provide high-level operations using core domain logic:

- **`ModelService.ts`**: ML model management
  - Downloads model files sequentially
  - Verifies model integrity
  - Manages model cache

- **`PipelineService.ts`**: Pipeline monitoring
  - Formats pipeline status for display
  - Aggregates processing metrics
  - Provides real-time statistics

- **`ReindexService.ts`**: Re-indexing service
  - High-level re-indexing API
  - Coordinates with UI updates
  - Manages user-initiated re-indexing

## Worker Thread

### `src/main/worker/`

Minimal worker thread implementation:

- **`index.ts`**: Worker thread entry point
  - Initializes core components
  - Sets up IPC communication
  - Manages worker lifecycle

- **`config.ts`**: Configuration management
  - Loads user preferences
  - Manages runtime configuration
  - Handles config persistence

- **`embedder.child.ts`**: Child process for embeddings
  - Isolated process for memory safety
  - Runs transformer model
  - Auto-restarts on memory threshold

## Shared Code

### `src/shared/`

Code shared between main and renderer processes:

#### `embeddings/` - Embedder Implementations
- **`embedder-pool.ts`**: Pool of embedder processes
- **`isolated.ts`**: Isolated embedder process
- **`HealthManager.ts`**: Health monitoring
- **`interfaces/`**: TypeScript interfaces
- **`implementations/`**: Concrete implementations

#### `utils/` - Shared Utilities
- **`logger.ts`**: Centralized logging
- **`ProcessMemoryMonitor.ts`**: Memory monitoring
- **`SerialQueue.ts`**: Serial task execution
- **`LoadBalancer.ts`**: Load distribution

## Design Principles

### 1. Domain-Driven Design
- Code organized by business domain, not technical layers
- Clear boundaries between domains
- Each domain is self-contained with its own logic

### 2. Separation of Concerns
- Core logic separated from infrastructure
- Services layer for high-level operations
- Worker thread only handles coordination

### 3. Testability
- Core logic isolated from Electron/Node specifics
- Dependency injection for testing
- Clear interfaces between components

### 4. Performance
- Domains optimized independently
- Minimal cross-domain dependencies
- Efficient data flow between components

## Migration from Previous Structure

The refactoring moved files from a flat worker directory to domain-specific folders:

| Old Location | New Location | Purpose |
|--------------|--------------|---------|
| `worker/fileScanner.ts` | `core/indexing/fileScanner.ts` | Domain organization |
| `worker/EmbeddingQueue.ts` | `core/embedding/EmbeddingQueue.ts` | Domain organization |
| `worker/reindexManager.ts` | `core/reindex/reindexManager.ts` | Domain organization |
| `worker/modelDownloader.ts` | `services/ModelService.ts` | Service layer |
| `worker/PipelineStatusFormatter.ts` | `services/PipelineService.ts` | Service layer |

## Benefits

1. **Improved Navigation**: Related files grouped together
2. **Clear Dependencies**: Domain boundaries prevent coupling
3. **Better Testing**: Core logic isolated from infrastructure
4. **Easier Onboarding**: Structure reflects business domains
5. **Scalability**: New domains can be added independently