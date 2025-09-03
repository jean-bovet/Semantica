# E2E Model Loading Test Plan

## Overview

This document outlines the plan for implementing end-to-end tests that verify the complete model loading sequence, including first-time download, progress indication, and UI readiness.

## Goals

1. Test the complete first-time user experience (no model present)
2. Verify model download progress indicator works correctly
3. Ensure UI becomes ready after model loads
4. Make tests reliable and maintainable

## Test Architecture

### Test Structure

```typescript
test.describe('Model Loading Sequence', () => {
  test('should download model and show progress on first launch', async () => {
    // Step 1: Clean state - ensure no model exists
    // Step 2: Launch app with test environment
    // Step 3: Verify download progress indicator appears
    // Step 4: Monitor download progress updates
    // Step 5: Wait for model download to complete
    // Step 6: Verify UI becomes ready
  });
  
  test('should use cached model on second launch', async () => {
    // Step 1: Launch app with existing model
    // Step 2: Verify no download occurs
    // Step 3: Verify quick startup
  });
});
```

## Implementation Details

### 1. Environment Configuration

```typescript
// Test-specific environment variables
const TEST_ENV = {
  TRANSFORMERS_CACHE: '/tmp/semantica-test-models',  // Isolated test directory
  NODE_ENV: 'test',
  ELECTRON_DISABLE_SINGLETON: 'true',
  FORCE_MODEL_DOWNLOAD: 'true'  // Optional flag to force fresh download
};
```

### 2. Model Directory Management

```typescript
// helpers/model-cleanup.ts
import * as fs from 'fs';
import * as path from 'path';

export async function cleanModelDirectory(modelPath: string) {
  if (fs.existsSync(modelPath)) {
    fs.rmSync(modelPath, { recursive: true, force: true });
  }
  fs.mkdirSync(modelPath, { recursive: true });
}

export function getTestModelPath() {
  return process.env.TEST_MODEL_PATH || '/tmp/semantica-test-models';
}
```

### 3. Progress Verification Strategy

```typescript
// Verification steps with specific assertions
async function verifyModelDownload(window: Page) {
  // 1. Initial state - loading indicator visible
  const loading = window.getByTestId('loading-indicator');
  await expect(loading).toBeVisible({ timeout: 2000 });
  
  // 2. Download starts - shows "Downloading AI Model"
  await expect(loading).toContainText('Downloading AI Model', { timeout: 5000 });
  
  // 3. Progress updates - verify percentage changes
  let lastProgress = 0;
  for (let i = 0; i < 10; i++) {  // Check up to 10 times
    const text = await loading.textContent();
    const match = text?.match(/(\d+)%/);
    if (match) {
      const currentProgress = parseInt(match[1]);
      expect(currentProgress).toBeGreaterThanOrEqual(lastProgress);
      lastProgress = currentProgress;
      if (currentProgress === 100) break;
    }
    await window.waitForTimeout(3000);  // Check every 3 seconds
  }
  
  // 4. Download complete - shows "Initializing database"
  await expect(loading).toContainText('Initializing database', { timeout: 10000 });
  
  // 5. Loading dismissed - UI ready
  await expect(loading).toBeHidden({ timeout: 10000 });
}
```

### 4. Test Implementation

```typescript
// tests/e2e/model-loading.spec.ts
import { test, expect, _electron as electron } from '@playwright/test';
import { cleanModelDirectory, getTestModelPath } from './helpers/model-cleanup';

test.describe('Model Loading Sequence', () => {
  // Extended timeout for download tests
  test.setTimeout(120000);  // 2 minutes
  
  test.beforeEach(async () => {
    // Clean model directory before each test
    await cleanModelDirectory(getTestModelPath());
  });
  
  test('should download model on first launch', async () => {
    const app = await electron.launch({
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        TRANSFORMERS_CACHE: getTestModelPath(),
        NODE_ENV: 'test',
        ELECTRON_DISABLE_SINGLETON: 'true'
      }
    });
    
    const window = await app.firstWindow();
    
    // Verify download sequence
    await verifyModelDownload(window);
    
    // Verify app is functional
    const searchInput = window.locator('input[type="text"]');
    await expect(searchInput).toBeVisible();
    
    await app.close();
  });
  
  test('should skip download with existing model', async () => {
    // First, copy a cached model to test directory
    // This simulates having downloaded the model before
    
    const app = await electron.launch({
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        TRANSFORMERS_CACHE: getTestModelPath(),
        NODE_ENV: 'test',
        ELECTRON_DISABLE_SINGLETON: 'true'
      }
    });
    
    const window = await app.firstWindow();
    
    // Should NOT show "Downloading AI Model"
    const loading = window.getByTestId('loading-indicator');
    const hasDownloadText = await loading.textContent()
      .then(text => text?.includes('Downloading AI Model'))
      .catch(() => false);
    
    expect(hasDownloadText).toBeFalsy();
    
    // App should be ready quickly
    await expect(loading).toBeHidden({ timeout: 10000 });
    
    await app.close();
  });
});
```

## File Structure

```
tests/
  e2e/
    app-startup.spec.ts        # Quick startup tests (existing)
    model-loading.spec.ts      # Comprehensive model tests (new)
    helpers/
      model-cleanup.ts         # Utility functions for test setup
```

## Testing Phases

### Phase 1: Basic Implementation (Priority 1)
- Clean model directory before test
- Launch app and wait for download
- Verify basic progress indicator
- Ensure app becomes ready

### Phase 2: Progress Tracking (Priority 2)
- Track download percentage updates
- Verify progress increases monotonically
- Capture screenshots at key stages
- Add detailed progress logging

### Phase 3: Error Handling (Priority 3)
- Test network failure scenarios
- Test partial download recovery
- Test corrupted model handling
- Verify error messages to user

### Phase 4: Optimization (Priority 4)
- Cache model for reuse in CI
- Implement model mocking for speed
- Parallel test execution strategies
- Reduce total test time

## CI/CD Considerations

### GitHub Actions Configuration
```yaml
- name: E2E Model Tests
  run: |
    # Run only on main branch or release branches
    if [[ "${{ github.ref }}" == "refs/heads/main" ]] || [[ "${{ github.ref }}" == refs/heads/release/* ]]; then
      npm run test:e2e:model
    fi
  env:
    TEST_MODEL_PATH: /tmp/ci-models
```

### Test Execution Strategies
1. **Local Development**: Use cached models when available
2. **Pull Requests**: Skip model download tests (too slow)
3. **Main Branch**: Run full model tests
4. **Release**: Run comprehensive test suite

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|---------|------------|
| Tests take too long (60+ seconds) | Slow CI/CD pipeline | Cache models, run selectively |
| Network flakiness | False test failures | Add retries, use local CDN mock |
| Disk space issues | Test failures | Clean up after tests, monitor usage |
| Model changes break tests | Maintenance burden | Version-lock test models |
| Affects developer's models | Data loss | Use isolated test directory |

## Performance Targets

- First-time download test: < 90 seconds
- Cached model test: < 10 seconds
- Total test suite: < 2 minutes
- CI pipeline impact: < 5 minute increase

## Success Metrics

1. **Coverage**: Tests verify all model loading states
2. **Reliability**: < 1% flake rate
3. **Speed**: Tests complete within targets
4. **Maintainability**: Clear failure messages, easy debugging
5. **Isolation**: No impact on development environment

## Implementation Timeline

- **Week 1**: Implement Phase 1 (basic tests)
- **Week 2**: Add Phase 2 (progress tracking)
- **Week 3**: Add Phase 3 (error handling)
- **Week 4**: Optimize and integrate with CI

## Notes

- Model size: ~30MB compressed, ~100MB uncompressed
- Download time: 10-60 seconds depending on connection
- First-time startup includes: download + extraction + initialization
- Consider implementing a test mode that uses a smaller model

## Future Enhancements

1. **Model version testing**: Test upgrades between model versions
2. **Offline mode**: Test behavior without internet
3. **Multiple models**: Test switching between different models
4. **Performance metrics**: Track model load times over releases
5. **Visual regression**: Screenshot comparison of progress states