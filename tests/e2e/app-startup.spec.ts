import { test, expect, _electron as electron } from '@playwright/test';

test.describe('App Startup', () => {
  test('should launch and display main window', async () => {
    const app = await electron.launch({
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ELECTRON_DISABLE_SINGLETON: 'true'
      }
    });
    
    const window = await app.firstWindow();
    
    // Verify window exists and has correct title
    expect(window).toBeTruthy();
    const title = await window.title();
    expect(title).toBe('Offline Search');
    
    // Wait for content to load
    await window.waitForTimeout(2000);
    
    // Check if we have the main app div (the React root)
    const appDiv = await window.locator('#root').count();
    expect(appDiv).toBeGreaterThan(0);
    
    await app.close();
  });

  test('should display search interface', async () => {
    const app = await electron.launch({
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ELECTRON_DISABLE_SINGLETON: 'true'
      }
    });
    
    const window = await app.firstWindow();
    await window.waitForTimeout(3000); // Wait for app to fully load
    
    // Check for search-related elements by class or role
    const searchElements = await window.locator('input[type="text"]').count();
    expect(searchElements).toBeGreaterThan(0); // Should have at least one text input
    
    await app.close();
  });
});