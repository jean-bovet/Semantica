# Worker Service Architecture

## Overview

This document describes the refactored worker thread architecture, transitioning from a monolithic 1,700-line file to a modular, service-oriented design with clear separation of concerns.

## Problem Statement

The original `worker/index.ts` had grown to over 1,700 lines and exhibited several issues:

1. **Poor Testability**: Tightly coupled code made unit testing nearly impossible without extensive mocking
2. **Difficult Maintenance**: Finding specific functionality required scrolling through hundreds of lines
3. **High Cognitive Load**: Understanding the full system required holding too much context in memory
4. **Slow Startup**: All operations initialized synchronously, causing 10+ second startup times
5. **No Clear Boundaries**: Database, file watching, queueing, and ML operations were intermingled

## Solution: Service-Oriented Architecture

### Core Principles

1. **Single Responsibility**: Each service handles one specific domain
2. **Dependency Injection**: Services receive dependencies through constructors or setters
3. **Interface-Based**: All services implement well-defined interfaces
4. **Minimal Coupling**: Services communicate through events and method calls, not shared state
5. **Progressive Enhancement**: Fast operations complete first, slow operations continue in background

### Service Breakdown

#### 1. DatabaseService
- **Responsibility**: All LanceDB operations
- **Key Methods**: `connect()`, `disconnect()`, `getChunksTable()`, `queryFiles()`, `updateFileStatus()`
- **Dependencies**: None (pure I/O service)
- **Testing Strategy**: In-memory database or temp directory

#### 2. FileWatcherService
- **Responsibility**: File system monitoring with Chokidar
- **Key Methods**: `start()`, `stop()`, `scanForChanges()`
- **Events**: `add`, `change`, `unlink`
- **Dependencies**: None (wraps Chokidar)
- **Testing Strategy**: Temp directory with real file operations

#### 3. QueueService
- **Responsibility**: Managing file indexing queue
- **Key Methods**: `add()`, `process()`, `pause()`, `resume()`
- **Events**: `processed`, `error`, `empty`
- **Dependencies**: Process callback (injected)
- **Testing Strategy**: Pure in-memory operations

#### 4. ConfigService
- **Responsibility**: Configuration management
- **Key Methods**: `load()`, `getSettings()`, `updateSettings()`
- **Dependencies**: ConfigManager (injected)
- **Testing Strategy**: Temp config files

#### 5. ModelService
- **Responsibility**: ML model and embedding operations
- **Key Methods**: `initialize()`, `checkModel()`, `embed()`
- **Dependencies**: EmbedderPool
- **Testing Strategy**: Mock embedder for unit tests, real model for integration

#### 6. WorkerCore
- **Responsibility**: Orchestrating all services
- **Key Methods**: `initialize()`, `handleMessage()`, `shutdown()`
- **Dependencies**: All services (injected or created)
- **Testing Strategy**: Real services with test data

### Startup Optimization

The refactored architecture implements a two-phase initialization:

```typescript
// Phase 1: Fast initialization (< 1 second)
initializeFast() {
  - Create directories
  - Load configuration
  - Connect to database
  - Send 'ready' signal
}

// Phase 2: Slow initialization (background)
initializeSlow() {
  - Load file status cache
  - Check ML model
  - Start file watcher
  - Migrate existing data
}
```

This reduces perceived startup time from 10+ seconds to under 1 second.

## Benefits Achieved

### 1. Improved Testability
- Each service can be tested in isolation
- Dependencies can be injected for testing
- Minimal mocking required

### 2. Better Maintainability
- Clear service boundaries
- Easy to locate functionality
- Simpler debugging

### 3. Enhanced Performance
- Faster startup through deferred initialization
- Better memory management
- Cleaner shutdown process

### 4. Scalability
- Easy to add new services
- Services can be moved to separate processes if needed
- Clear upgrade path to microservices

## Migration Path

The refactoring was completed incrementally:

1. Define service interfaces
2. Extract DatabaseService (easiest, no dependencies)
3. Extract FileWatcherService and QueueService (minimal dependencies)
4. Extract ConfigService and ModelService (some coupling)
5. Create WorkerCore to orchestrate
6. Reduce index.ts to a thin entry point

## Code Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Lines in index.ts | 1,700+ | 97 | 94% reduction |
| Number of files | 1 | 7 | Better organization |
| Testable units | 1 | 6 | 600% increase |
| Startup time | 10+ sec | <1 sec | 90% reduction |
| Cyclomatic complexity | High | Low | Significant reduction |

## Future Enhancements

1. **Service Registry**: Dynamic service discovery and registration
2. **Event Bus**: Decouple services further with centralized event system
3. **Metrics Service**: Collect and report performance metrics
4. **Health Checks**: Built-in health monitoring for each service
5. **Configuration Hot-Reload**: Update settings without restart

## Conclusion

The service-oriented refactoring has transformed a monolithic, hard-to-maintain codebase into a modular, testable, and performant system. The clear separation of concerns makes the code easier to understand, test, and extend, while the two-phase initialization dramatically improves the user experience.