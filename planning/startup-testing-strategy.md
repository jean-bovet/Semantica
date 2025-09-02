# Startup Testing Strategy

## Overview

This document outlines the testing strategy for the Electron app startup sequence, based on research of current best practices (2024) and the specific needs of this project.

## Context

- **Project Size**: Small team/solo project
- **Focus Area**: App startup sequence and initialization
- **Current Issue**: Delay before UI shows loading indicator
- **Solution Implemented**: Load window immediately, initialize worker async, wait for both model and files before dismissing loading

## Research Findings

Based on research of Electron testing best practices in 2024:

1. **Industry Consensus**: Hybrid approach combining mocked unit tests with real E2E tests
2. **Electron Community**: Recommends mocking for unit tests, real implementation for integration
3. **Small Projects**: Avoid over-engineering, focus on critical paths
4. **Startup Testing**: Requires special attention to async coordination and race conditions

## Recommended Approach: Minimal Refactoring + Strategic Testing

### Architecture

```typescript
// 1. Extract coordination logic into testable class
export class StartupCoordinator {
  constructor(private mode: 'production' | 'test' = 'production') {}
  
  async coordinateStartup(
    onWindowReady: () => void,
    onWorkerReady: () => void,
    onFilesLoaded: () => void
  ) {
    // Sequencing logic here
    // Callbacks for key events
  }
}

// 2. Keep Electron calls direct in main.ts
app.whenReady().then(async () => {
  const coordinator = new StartupCoordinator();
  
  // Real Electron calls stay here
  const win = new BrowserWindow(config);
  win.loadURL('http://localhost:5173');
  
  // Test the coordination, not the Electron APIs
  await coordinator.coordinateStartup(
    () => win.show(),
    () => spawnWorker(),
    () => win.webContents.send('files:loaded')
  );
});
```

### Testing Distribution

- **80% Unit Tests**: Test coordination logic with mocks
- **20% E2E Tests**: Smoke test the full startup flow

## Implementation Plan

### Phase 1: Extract Coordination Logic

1. Create `src/main/startup/StartupCoordinator.ts`
2. Move sequencing logic from `main.ts`
3. Keep all Electron API calls in `main.ts`
4. Use callbacks/events for communication

### Phase 2: Unit Tests

Create `src/main/startup/__tests__/StartupCoordinator.test.ts`:

```typescript
describe('StartupCoordinator', () => {
  it('should load window before worker initialization');
  it('should wait for both model and files before signaling ready');
  it('should handle worker timeout gracefully');
  it('should compute stats before sending files:loaded');
});
```

### Phase 3: E2E Smoke Test

Create `e2e/startup.test.ts` using Playwright:

```typescript
test('app starts with correct initialization sequence', async () => {
  // Launch app
  // Verify loading appears immediately
  // Verify loading dismisses only after initialization
  // Verify status bar shows correct stats
});
```

## Benefits of This Approach

✅ **Low Overhead**: Minimal new abstractions
✅ **Fast Tests**: Most tests don't need Electron runtime
✅ **Real Confidence**: E2E test catches integration issues
✅ **Easy Debugging**: Direct Electron calls remain in main.ts
✅ **Maintainable**: Changes mostly in one place

## What We're NOT Doing

❌ **Full Dependency Injection**: Overkill for this project size
❌ **Wrapper Classes for Electron APIs**: Adds unnecessary complexity
❌ **100% Mock Coverage**: Some things need real testing
❌ **Complex State Machines**: YAGNI (You Aren't Gonna Need It)

## Success Metrics

1. **Unit tests run in < 1 second**
2. **E2E test completes in < 10 seconds**
3. **No false positives from timing issues**
4. **Easy to understand for new contributors**
5. **Catches startup sequence regressions**

## Tools Required

- **Jest**: Unit testing framework
- **Playwright**: E2E testing for Electron
- **GitHub Actions**: CI/CD to run tests

## Timeline

- **Week 1**: Extract StartupCoordinator class
- **Week 2**: Implement unit tests
- **Week 3**: Add E2E smoke test
- **Week 4**: Integrate with CI/CD

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Tests don't catch real timing issues | E2E test covers real behavior |
| Mocks drift from reality | Keep mocks minimal, test interfaces |
| E2E tests flaky | Proper wait conditions, retry logic |
| Refactoring breaks existing code | Incremental changes, keep tests green |

## Decision

**Proceed with minimal refactoring approach** - Extract only the coordination logic for unit testing while keeping Electron APIs direct. This provides good test coverage without over-engineering.

## References

- [Electron Testing Documentation](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
- [Stack Overflow: Unit Testing Electron Main Process](https://stackoverflow.com/questions/36351229/)
- [DEV: Electron Testing Best Practices with Jest](https://dev.to/woovi/electron-testing-best-practices-testing-main-and-renderer-code-with-jest-4b5m)
- Research conducted: January 2025