# Embedder Refactoring Plan

## Overview

This document outlines a comprehensive refactoring plan for the embedder system to improve code simplicity, testability, and maintainability. The current embedder implementation has grown complex with tightly coupled concerns and monolithic classes.

## Current Issues

1. **Tightly coupled child process management** - IsolatedEmbedder has too many responsibilities
2. **Mixed concerns** - Serial queue logic is embedded in the child process script
3. **Complex state management** - Multiple flags and promises for tracking spawning/ready state
4. **Global singletons** - Hard to test and reason about
5. **Hardcoded paths and configuration** - Environment-specific logic scattered throughout
6. **Large monolithic classes** - Hard to test individual components

## Refactoring Strategy

### Phase 1: Extract Core Utilities (Foundation)

#### 1.1 SerialQueue<T> Class
- **Current**: 3 global variables in `embedder.child.ts` for promise chaining
- **Target**: Standalone, reusable, type-safe serial queue class
- **Location**: `src/shared/utils/SerialQueue.ts`
- **Benefits**:
  - Easily testable in isolation
  - Reusable for other async operations
  - Clear API with proper error handling
  - Type-safe operations

#### 1.2 ModelPathResolver Utility
- **Current**: Environment-specific path logic scattered across files
- **Target**: Centralized model path resolution utility
- **Location**: `src/shared/embeddings/ModelPathResolver.ts`
- **Benefits**:
  - Centralized path resolution logic
  - Environment-aware configuration
  - Easier to test different deployment scenarios
  - Consistent path handling

#### 1.3 EmbeddingProcessor Utility
- **Current**: Vector conversion logic embedded in child process
- **Target**: Standalone embedding processing utility
- **Location**: `src/shared/embeddings/EmbeddingProcessor.ts`
- **Benefits**:
  - Testable vector conversion logic
  - Reusable for different model outputs
  - Performance optimizations in one place
  - Clear separation of ML and IPC concerns

#### 1.4 ProcessMemoryMonitor Class
- **Current**: Memory checking embedded in `IsolatedEmbedder`
- **Target**: Standalone process memory monitoring utility
- **Location**: `src/shared/utils/ProcessMemoryMonitor.ts`
- **Benefits**:
  - Reusable for monitoring any process
  - Configurable thresholds and strategies
  - Better testing of memory-based restart logic
  - Platform-agnostic memory checking

### Phase 2: Refactor Child Process Management

#### 2.1 ChildProcessManager Class
- **Current**: 200+ lines of spawn/lifecycle logic in `IsolatedEmbedder`
- **Target**: Dedicated child process management class
- **Location**: `src/shared/utils/ChildProcessManager.ts`
- **Benefits**:
  - Single responsibility for process management
  - Easier to test process lifecycle without embedder logic
  - Reusable for other child processes
  - Better error handling and recovery

#### 2.2 IPCMessageProtocol Classes
- **Current**: Hand-crafted IPC message objects
- **Target**: Typed message classes with builders and validation
- **Location**: `src/shared/embeddings/IPCMessageProtocol.ts`
- **Benefits**:
  - Type safety for IPC communication
  - Easier to test message handling
  - Validation and serialization logic centralized
  - Protocol versioning support

#### 2.3 Simplify embedder.child.ts
- **Current**: 140+ lines mixing queue, IPC, and embedding logic
- **Target**: ~60 lines focused only on embedding operations
- **Changes**: Use SerialQueue and EmbeddingProcessor utilities

### Phase 3: Refactor Pool Architecture

#### 3.1 LoadBalancer Class
- **Current**: Round-robin logic mixed with pool management
- **Target**: Standalone load balancing utility
- **Location**: `src/shared/utils/LoadBalancer.ts`
- **Benefits**:
  - Single responsibility for request distribution
  - Different load balancing strategies possible
  - Easier testing of distribution logic
  - Reusable for other pooled resources

#### 3.2 HealthManager Class
- **Current**: Health monitoring mixed with restart logic in EmbedderPool
- **Target**: Dedicated health monitoring and recovery manager
- **Location**: `src/shared/embeddings/HealthManager.ts`
- **Benefits**:
  - Pluggable health check policies
  - Configurable restart strategies
  - Better testing of health monitoring
  - Separation of concerns

#### 3.3 EmbedderFactory Class
- **Current**: Inline embedder creation with hardcoded config
- **Target**: Factory pattern for creating configured embedders
- **Location**: `src/shared/embeddings/EmbedderFactory.ts`
- **Benefits**:
  - Centralized configuration management
  - Easier to test different configurations
  - Consistent embedder setup
  - Dependency injection support

### Phase 4: Remove Global State

#### 4.1 Convert Singletons to Dependency Injection
- **Current**: Global `embedder` and `embedderPool` variables
- **Target**: Factory-created instances with explicit dependencies
- **Changes**: Update all consumers to use injected instances

#### 4.2 Update Test Infrastructure
- **Target**: Isolated test instances without shared state
- **Benefits**: Better test isolation, easier mocking, parallel test execution

## Expected Outcomes

### Code Reduction
- **IsolatedEmbedder**: 450+ lines → ~150 lines
- **embedder.child.ts**: 140+ lines → ~60 lines
- **EmbedderPool**: 290+ lines → ~100 lines
- **Total**: 880+ lines → ~310 lines + focused utility classes

### Testing Improvements
Each extracted class becomes independently testable:
- **SerialQueue**: Test ordering, error isolation, concurrency
- **ChildProcessManager**: Test spawn, restart, cleanup without embedding
- **ModelPathResolver**: Test path resolution across environments
- **ProcessMemoryMonitor**: Test memory thresholds and restart triggers
- **LoadBalancer**: Test distribution algorithms
- **HealthManager**: Test restart strategies

### Maintainability Benefits
- Single responsibility classes
- Clear separation of concerns
- Better error handling and recovery
- Easier to add new features
- Reduced cognitive complexity

## Implementation Timeline

1. **Phase 1**: 2-3 days - Foundation utilities
2. **Phase 2**: 2-3 days - Child process refactoring
3. **Phase 3**: 2-3 days - Pool architecture
4. **Phase 4**: 1-2 days - Remove global state

**Total Estimated Time**: 1-2 weeks

## Risk Mitigation

1. **Incremental approach** - Each phase can be completed and tested independently
2. **Backward compatibility** - Maintain existing public APIs during transition
3. **Comprehensive testing** - Add tests for each new utility class
4. **Gradual migration** - Update consumers one at a time
5. **Rollback plan** - Keep existing implementation until new one is fully tested

## Success Criteria

- [ ] All existing functionality preserved
- [ ] Test coverage increased to >90%
- [ ] Code complexity reduced by 50%
- [ ] Build and deployment times unchanged
- [ ] Memory usage patterns unchanged
- [ ] Performance benchmarks maintained or improved