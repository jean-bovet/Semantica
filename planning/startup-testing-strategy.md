# Startup Testing Strategy

> **Status:** NEEDS UPDATE (Python Sidecar Architecture)
>
> **Update 2025-10-28:** References to "model download" and "embedder process" need updating for Python sidecar architecture. The core StartupCoordinator pattern is still valid, but implementation details differ:
> - **Model loading**: Now handled by Python sidecar (sentence-transformers), not Node.js
> - **waitForModel()**: Should be waitForPythonSidecar() - HTTP health check on port 8421
> - **Embedder process**: Now FastAPI HTTP server, not Node.js child process
>
> Core concepts (sensors/actions pattern, async coordination, testing strategy) remain applicable.

## Overview

This document outlines the testing strategy for the Electron app startup sequence, based on research of current best practices (2024) and the specific needs of this project.

## Context

- **Project Size**: Small team/solo project
- **Focus Area**: App startup sequence and initialization
- **Current Issue**: Delay before UI shows loading indicator
- **Solution Implemented**: Load window immediately, initialize worker async, wait for both model and files before dismissing loading
- **Testing Framework**: Vitest (already in use)
- **E2E Framework**: Playwright (already configured with `test:e2e`)

## Research Findings

Based on research of Electron testing best practices in 2024:

1. **Industry Consensus**: Hybrid approach combining mocked unit tests with real E2E tests
2. **Electron Community**: Recommends mocking for unit tests, real implementation for integration
3. **Small Projects**: Avoid over-engineering, focus on critical paths
4. **Startup Testing**: Requires special attention to async coordination and race conditions

## Recommended Approach: Minimal Refactoring + Strategic Testing

### StartupCoordinator Specification

The `StartupCoordinator` class will manage the startup sequence with clear responsibilities:

#### Inputs (Sensors)
- `waitForWorker(): Promise<void>` - Resolves when worker thread is ready
- `waitForModel(): Promise<void>` - Resolves when ML model is loaded
- `waitForFiles(): Promise<void>` - Resolves when file index is loaded from DB
- `waitForStats(): Promise<StatsData>` - Resolves when folder stats are computed

#### Outputs (Actions)
- `showWindow(): void` - Display window immediately (no waiting)
- `notifyFilesLoaded(): void` - Send `files:loaded` event to renderer
- `notifyReady(): void` - Signal complete initialization to renderer

#### Error Handling
- Worker timeout (10s default) → Surface error to renderer
- Model check/download failure → Fallback UI with retry option
- Files load failure → Show empty state with error message

#### Sequencing Rules
1. Window loads immediately (no blocking)
2. Model and files can load in parallel (race allowed)
3. Only signal ready when BOTH model and files are loaded
4. Stats must be computed before sending `files:loaded`

#### Lifecycle
- `dispose(): void` - Cancel all timers and listeners for clean shutdown

### Architecture

```typescript
// src/main/startup/StartupCoordinator.ts
export interface StartupSensors {
  waitForWorker(): Promise<void>;
  waitForModel(): Promise<void>;
  waitForFiles(): Promise<void>;
  waitForStats(): Promise<StatsData>;
}

export interface StartupActions {
  showWindow(): void;
  notifyFilesLoaded(): void;
  notifyReady(): void;
  notifyError(error: StartupError): void;
}

export class StartupCoordinator {
  private disposed = false;
  private timeouts: NodeJS.Timeout[] = [];
  
  constructor(
    private sensors: StartupSensors,
    private actions: StartupActions,
    private options = { workerTimeout: 10000 }
  ) {}
  
  async coordinate(): Promise<void> {
    // Show window immediately
    this.actions.showWindow();
    
    try {
      // Wait for worker with timeout
      await this.withTimeout(
        this.sensors.waitForWorker(),
        this.options.workerTimeout,
        'Worker initialization timeout'
      );
      
      // Load model and files in parallel
      const [modelResult, filesResult] = await Promise.allSettled([
        this.sensors.waitForModel(),
        this.sensors.waitForFiles()
      ]);
      
      if (modelResult.status === 'rejected') {
        throw new StartupError('model-failed', modelResult.reason);
      }
      
      if (filesResult.status === 'rejected') {
        throw new StartupError('files-failed', filesResult.reason);
      }
      
      // Compute stats before notifying
      await this.sensors.waitForStats();
      
      // All ready - notify renderer
      this.actions.notifyFilesLoaded();
      this.actions.notifyReady();
      
    } catch (error) {
      this.actions.notifyError(error as StartupError);
      throw error;
    }
  }
  
  dispose(): void {
    this.disposed = true;
    this.timeouts.forEach(t => clearTimeout(t));
  }
}
```

### Integration with Existing Code

```typescript
// src/main/main.ts (minimal changes)
app.whenReady().then(async () => {
  // Keep direct Electron calls here
  const win = new BrowserWindow(config);
  
  const coordinator = new StartupCoordinator(
    {
      waitForWorker: () => waitForWorker(),
      waitForModel: () => sendToWorker('checkModel'),
      waitForFiles: () => new Promise(resolve => {
        ipcMain.once('files:loaded', resolve);
      }),
      waitForStats: () => sendToWorker('stats')
    },
    {
      showWindow: () => win.loadURL('http://localhost:5173'),
      notifyFilesLoaded: () => win.webContents.send('files:loaded'),
      notifyReady: () => win.webContents.send('app:ready'),
      notifyError: (err) => win.webContents.send('startup:error', err)
    }
  );
  
  await coordinator.coordinate();
});
```

### Testing Distribution

- **80% Unit Tests**: Test coordination logic with mocks and fake timers
- **20% E2E Tests**: Smoke test the full startup flow with real Electron

## Implementation Plan

### Phase 1: Extract Coordination Logic

1. Create `src/main/startup/StartupCoordinator.ts`
2. Define interfaces for sensors and actions
3. Move sequencing logic from `main.ts`
4. Keep all Electron API calls in `main.ts`
5. Consolidate `win` and `mainWindow` references

### Phase 2: Unit Tests with Vitest

Create `tests/unit/startup-coordinator.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StartupCoordinator } from '@/main/startup/StartupCoordinator';

describe('StartupCoordinator', () => {
  let sensors: MockSensors;
  let actions: MockActions;
  let coordinator: StartupCoordinator;
  
  beforeEach(() => {
    vi.useFakeTimers();
    sensors = {
      waitForWorker: vi.fn().mockResolvedValue(undefined),
      waitForModel: vi.fn().mockResolvedValue(undefined),
      waitForFiles: vi.fn().mockResolvedValue(undefined),
      waitForStats: vi.fn().mockResolvedValue({ total: 100, indexed: 50 })
    };
    actions = {
      showWindow: vi.fn(),
      notifyFilesLoaded: vi.fn(),
      notifyReady: vi.fn(),
      notifyError: vi.fn()
    };
    coordinator = new StartupCoordinator(sensors, actions);
  });
  
  afterEach(() => {
    vi.useRealTimers();
    coordinator.dispose();
  });
  
  it('should show window immediately without waiting', async () => {
    const promise = coordinator.coordinate();
    
    // Window should show before any async operations
    expect(actions.showWindow).toHaveBeenCalled();
    expect(sensors.waitForWorker).not.toHaveBeenCalled();
    
    await promise;
  });
  
  it('should wait for both model AND files before notifying ready', async () => {
    // Delay model loading
    sensors.waitForModel.mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 1000))
    );
    
    const promise = coordinator.coordinate();
    
    // Advance time for model
    await vi.advanceTimersByTimeAsync(1000);
    
    // Ready should only be called after both complete
    await promise;
    expect(actions.notifyReady).toHaveBeenCalledTimes(1);
  });
  
  it('should handle worker timeout gracefully', async () => {
    sensors.waitForWorker.mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );
    
    const promise = coordinator.coordinate();
    
    // Advance past timeout
    await vi.advanceTimersByTimeAsync(10001);
    
    await expect(promise).rejects.toThrow('Worker initialization timeout');
    expect(actions.notifyError).toHaveBeenCalled();
  });
  
  it('should compute stats before sending files:loaded', async () => {
    await coordinator.coordinate();
    
    // Verify call order
    const statsIndex = sensors.waitForStats.mock.invocationCallOrder[0];
    const filesLoadedIndex = actions.notifyFilesLoaded.mock.invocationCallOrder[0];
    
    expect(statsIndex).toBeLessThan(filesLoadedIndex);
  });
  
  it('should handle files loading before model', async () => {
    // Files resolve immediately, model takes time
    sensors.waitForModel.mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 2000))
    );
    
    const promise = coordinator.coordinate();
    await vi.advanceTimersByTimeAsync(2000);
    await promise;
    
    expect(actions.notifyReady).toHaveBeenCalled();
  });
  
  it('should propagate model loading errors', async () => {
    const error = new Error('Model download failed');
    sensors.waitForModel.mockRejectedValue(error);
    
    await expect(coordinator.coordinate()).rejects.toThrow('model-failed');
    expect(actions.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'model-failed' })
    );
  });
});
```

### Phase 3: E2E Smoke Test with Playwright

Create `tests/e2e/app-startup.spec.ts`:

```typescript
import { test, expect, _electron as electron } from '@playwright/test';

test.describe('App Startup', () => {
  test('should show loading immediately and dismiss after initialization', async () => {
    const app = await electron.launch({ args: ['dist/main.cjs'] });
    const window = await app.firstWindow();
    
    // Loading indicator should appear immediately
    const loading = window.getByTestId('loading-indicator');
    await expect(loading).toBeVisible({ timeout: 1000 });
    
    // Loading message should update when model is ready
    await expect(loading).toContainText('Initializing database', { timeout: 5000 });
    
    // Loading should dismiss after both model and files are ready
    await expect(loading).toBeHidden({ timeout: 15000 });
    
    // Status bar should show non-zero stats
    const statusBar = window.getByTestId('status-bar');
    await expect(statusBar).toBeVisible();
    const statsText = await statusBar.textContent();
    expect(statsText).not.toContain('0 files');
    expect(statsText).toContain('indexed');
    
    await app.close();
  });
  
  test('should handle worker initialization failure', async () => {
    // Set env to simulate worker failure
    process.env.FAIL_WORKER_INIT = 'true';
    
    const app = await electron.launch({ args: ['dist/main.cjs'] });
    const window = await app.firstWindow();
    
    // Should show error state
    const errorMessage = window.getByTestId('startup-error');
    await expect(errorMessage).toBeVisible({ timeout: 12000 });
    await expect(errorMessage).toContainText('initialization failed');
    
    await app.close();
  });
});
```

### Required Test IDs

Add these data attributes to components for E2E testing:

- `data-testid="loading-indicator"` - Loading overlay div
- `data-testid="status-bar"` - StatusBar component
- `data-testid="startup-error"` - Error message container
- `data-testid="app-ready"` - Main content when fully loaded

## Benefits of This Approach

✅ **Low Overhead**: Minimal new abstractions  
✅ **Fast Tests**: Unit tests use fake timers (< 1s on CI)  
✅ **Real Confidence**: E2E test catches actual integration issues  
✅ **Easy Debugging**: Direct Electron calls remain in main.ts  
✅ **Maintainable**: Clear separation of concerns  
✅ **Existing Tools**: Uses Vitest and Playwright already in project

## What We're NOT Doing

❌ **Full Dependency Injection**: Overkill for this project size  
❌ **Wrapper Classes for Electron APIs**: Adds unnecessary complexity  
❌ **100% Mock Coverage**: Some things need real testing  
❌ **Complex State Machines**: YAGNI (You Aren't Gonna Need It)

## Success Metrics

1. **Unit tests run in < 1 second** (using fake timers for timeout tests)
2. **E2E test completes in < 10 seconds on CI runners**
3. **No false positives from timing issues**
4. **Startup telemetry shows consistent time-to-ready**
5. **Clear error states for all failure modes**

## Startup Telemetry

Add simple timing measurements in development:

```typescript
// src/main/startup/telemetry.ts
export class StartupTelemetry {
  private marks = new Map<string, number>();
  
  mark(event: string): void {
    this.marks.set(event, Date.now());
  }
  
  measure(from: string, to: string): number {
    const start = this.marks.get(from);
    const end = this.marks.get(to);
    return end && start ? end - start : -1;
  }
  
  report(): void {
    if (process.env.NODE_ENV === 'development') {
      console.log('Startup Metrics:');
      console.log(`  Time to window: ${this.measure('app-start', 'window-shown')}ms`);
      console.log(`  Time to ready: ${this.measure('app-start', 'app-ready')}ms`);
    }
  }
}
```

## Tools Required

- **Vitest**: Unit testing framework (already installed)
- **Playwright**: E2E testing for Electron (already configured)
- **GitHub Actions**: CI/CD to run tests (existing workflow)

## File Structure

```
tests/
  unit/
    startup-coordinator.spec.ts
  e2e/
    app-startup.spec.ts
src/
  main/
    startup/
      StartupCoordinator.ts
      telemetry.ts
    main.ts (minimal changes)
```

## Timeline

- **Week 1**: Extract StartupCoordinator class and interfaces
- **Week 2**: Implement unit tests with Vitest
- **Week 3**: Add E2E smoke tests with Playwright
- **Week 4**: Add telemetry and integrate with CI

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Tests don't catch real timing issues | E2E test with real Electron process |
| Mocks drift from reality | Keep interfaces minimal and stable |
| E2E tests flaky | Use data-testid selectors, avoid time-based waits |
| Refactoring breaks existing code | Incremental changes, keep all tests green |
| Worker/model race conditions | Promise.allSettled handles independent failures |

## Decision

**Proceed with minimal refactoring approach** - Extract only the coordination logic into `StartupCoordinator` for unit testing while keeping Electron APIs direct in `main.ts`. This provides good test coverage without over-engineering.

## References

- [Electron Testing Documentation](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
- [Vitest Documentation](https://vitest.dev/guide/)
- [Playwright Electron Testing](https://playwright.dev/docs/api/class-electron)
- Research conducted: January 2025