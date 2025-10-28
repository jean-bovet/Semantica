/**
 * E2E tests for Settings UI folder display
 *
 * This test prevents regression of the bug where folders from config.json
 * were not displayed in the Settings UI because IPC calls failed with
 * "Worker not ready" due to incorrect workerReady flag handling.
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';

test.describe('Settings Folders Display', () => {
  let testUserDataPath: string;

  test.beforeEach(() => {
    // Create temporary user data directory
    testUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'semantica-test-'));
  });

  test.afterEach(() => {
    // Clean up
    if (fs.existsSync(testUserDataPath)) {
      fs.rmSync(testUserDataPath, { recursive: true, force: true });
    }
  });

  test('should display folders from config.json after startup completes', async () => {
    // Create config.json with test folders
    const dataDir = path.join(testUserDataPath, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const testFolders = [
      '/Users/test/Documents',
      '/Users/test/Dropbox'
    ];

    const config = {
      version: '1.0.0',
      watchedFolders: testFolders,
      settings: {
        cpuThrottle: 'medium',
        excludePatterns: ['node_modules', '.git'],
        excludeBundles: true,
        bundlePatterns: [],
        fileTypes: {},
        embeddingBatchSize: 32,
        embedderPoolSize: 2
      },
      lastUpdated: new Date().toISOString()
    };

    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );

    // Launch app with test user data path
    const app = await electron.launch({
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        USER_DATA_PATH: testUserDataPath,
        ELECTRON_DISABLE_SINGLETON: 'true'
      }
    });

    const window = await app.firstWindow();

    // Wait for app to fully initialize (worker ready)
    await window.waitForTimeout(5000);

    // Open settings view
    // Note: Adjust selector based on your actual UI
    const settingsButton = window.locator('[data-testid="settings-button"]')
      .or(window.locator('button:has-text("Settings")'))
      .first();

    if (await settingsButton.count() > 0) {
      await settingsButton.click();
      await window.waitForTimeout(1000);
    }

    // Verify folders are displayed
    // The critical test: these should NOT be empty/missing
    const folderElements = await window.locator('[data-testid="folder-item"]')
      .or(window.locator('.folder-item'))
      .count();

    // Should have exactly 2 folders displayed
    expect(folderElements).toBeGreaterThan(0);

    // Verify no "Worker not ready" errors in console
    const consoleErrors: string[] = [];
    window.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.waitForTimeout(1000);

    const workerNotReadyErrors = consoleErrors.filter(err =>
      err.includes('Worker not ready')
    );

    expect(workerNotReadyErrors).toHaveLength(0);

    await app.close();
  });

  test('should show "No folders" when config is empty', async () => {
    // Create empty config
    const dataDir = path.join(testUserDataPath, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const config = {
      version: '1.0.0',
      watchedFolders: [],
      settings: {
        cpuThrottle: 'medium',
        excludePatterns: ['node_modules'],
        excludeBundles: true,
        bundlePatterns: [],
        fileTypes: {},
        embeddingBatchSize: 32,
        embedderPoolSize: 2
      },
      lastUpdated: new Date().toISOString()
    };

    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );

    const app = await electron.launch({
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        USER_DATA_PATH: testUserDataPath,
        ELECTRON_DISABLE_SINGLETON: 'true'
      }
    });

    const window = await app.firstWindow();
    await window.waitForTimeout(5000);

    // Open settings
    const settingsButton = window.locator('[data-testid="settings-button"]')
      .or(window.locator('button:has-text("Settings")'))
      .first();

    if (await settingsButton.count() > 0) {
      await settingsButton.click();
      await window.waitForTimeout(1000);
    }

    // Should show empty state message
    const emptyState = await window.locator('[data-testid="empty-state"]')
      .or(window.locator('.empty-state'))
      .or(window.locator('text=/No folders/i'))
      .count();

    expect(emptyState).toBeGreaterThan(0);

    await app.close();
  });

  test('should not throw "Worker not ready" when opening settings immediately', async () => {
    // This test specifically checks the timing bug where UI tries
    // to load folders before worker signals ready

    const dataDir = path.join(testUserDataPath, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const config = {
      version: '1.0.0',
      watchedFolders: ['/Users/test/Documents'],
      settings: {
        cpuThrottle: 'medium',
        excludePatterns: [],
        excludeBundles: true,
        bundlePatterns: [],
        fileTypes: {},
        embeddingBatchSize: 32,
        embedderPoolSize: 2
      },
      lastUpdated: new Date().toISOString()
    };

    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );

    const app = await electron.launch({
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        USER_DATA_PATH: testUserDataPath,
        ELECTRON_DISABLE_SINGLETON: 'true'
      }
    });

    const window = await app.firstWindow();

    // Collect console errors
    const consoleErrors: string[] = [];
    window.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait for startup to complete - this should set workerReady=true
    await window.waitForTimeout(5000);

    // Now try to access settings - should not fail
    const settingsButton = window.locator('[data-testid="settings-button"]')
      .or(window.locator('button:has-text("Settings")'))
      .first();

    if (await settingsButton.count() > 0) {
      await settingsButton.click();
      await window.waitForTimeout(1000);
    }

    // Verify no "Worker not ready" errors
    const workerErrors = consoleErrors.filter(err =>
      err.includes('Worker not ready') ||
      err.includes('indexer:getWatchedFolders')
    );

    expect(workerErrors).toHaveLength(0);

    await app.close();
  });
});
