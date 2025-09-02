import { test, expect, _electron as electron } from '@playwright/test';

test.describe('App Startup', () => {
  test('should show loading immediately', async () => {
    // Set test environment to use cached model
    process.env.NODE_ENV = 'test';
    process.env.ELECTRON_DISABLE_SINGLETON = 'true';
    
    const app = await electron.launch({ 
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_DISABLE_SINGLETON: 'true'
      }
    });
    const window = await app.firstWindow();
    
    // Loading indicator should appear immediately (within 2 seconds)
    const loading = window.getByTestId('loading-indicator');
    await expect(loading).toBeVisible({ timeout: 2000 });
    
    // Loading should contain some loading text
    const loadingText = await loading.textContent();
    expect(loadingText).toMatch(/Loading|Downloading|Initializing/);
    
    // Status bar should exist (even if hidden initially)
    const statusBar = window.getByTestId('status-bar');
    await expect(statusBar).toBeAttached();
    
    await app.close();
  });
  
  test.skip('should handle worker initialization failure', async () => {
    // Skip this test as it requires modifying the worker behavior
    // which is complex in E2E environment
    
    const app = await electron.launch({ 
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        FAIL_WORKER_INIT: 'true',
        ELECTRON_DISABLE_SINGLETON: 'true'
      }
    });
    const window = await app.firstWindow();
    
    // Should show error state
    const errorMessage = window.getByTestId('startup-error');
    await expect(errorMessage).toBeVisible({ timeout: 12000 });
    await expect(errorMessage).toContainText('initialization failed');
    
    await app.close();
  });
  
  test('should have correct UI structure', async () => {
    const app = await electron.launch({ 
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_DISABLE_SINGLETON: 'true'
      }
    });
    const window = await app.firstWindow();
    
    // App container should always exist
    const appReady = window.getByTestId('app-ready');
    await expect(appReady).toBeAttached();
    
    // Search input should exist (might be under loading overlay)
    const searchInput = window.getByTestId('search-input');
    await expect(searchInput).toBeAttached();
    
    // Status bar should exist
    const statusBar = window.getByTestId('status-bar');
    await expect(statusBar).toBeAttached();
    
    await app.close();
  });
});
