import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

test.describe('Model Download', () => {
  let testDir: string;
  
  test.beforeEach(async () => {
    // Create a unique temporary directory for each test
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    testDir = path.join(os.tmpdir(), `semantica-e2e-${timestamp}-${random}`);
    
    // Ensure the directory is completely clean
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    
    console.log('[TEST] Using clean test directory:', testDir);
  });

  test.afterEach(async () => {
    // Clean up test directory after each test
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
        console.log('[TEST] Cleaned up test directory:', testDir);
      } catch (err) {
        console.warn('[TEST] Failed to clean up test directory:', err);
      }
    }
  });

  test('should download model when starting with clean directory', async () => {
    // Launch app with completely isolated directories
    const app = await electron.launch({
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SINGLETON: 'true',
        NODE_ENV: 'test',
        // Override all possible model paths to point to our clean directory
        USER_DATA_PATH: testDir,
        TRANSFORMERS_CACHE: path.join(testDir, 'models'),
        // Clear any default paths
        HOME: testDir,
        APPDATA: testDir,
        XDG_CACHE_HOME: testDir
      }
    });
    
    try {
      const window = await app.firstWindow();
      console.log('[TEST] Window opened');
      
      // The app should detect no model and show download dialog
      const downloadDialog = window.locator('text=Downloading AI Model');
      await expect(downloadDialog).toBeVisible({ timeout: 15000 });
      console.log('[TEST] Download dialog appeared');
      
      // Check for progress bar
      const progressBar = window.locator('div[style*="transition: width"]');
      await expect(progressBar).toBeVisible();
      console.log('[TEST] Progress bar visible');
      
      // Since actual download would take too long, we'll just verify the UI appears
      // In real scenario, you'd want to mock the network requests here
      
      // For now, just close the app after verifying download started
      await window.waitForTimeout(2000);
      console.log('[TEST] Download UI verified');
      
    } finally {
      await app.close();
    }
  });

  test('should skip download when model exists', async () => {
    // Pre-create mock model files in the test directory
    const modelDir = path.join(testDir, 'models', 'Xenova', 'multilingual-e5-small');
    const onnxDir = path.join(modelDir, 'onnx');
    
    // Create directory structure
    fs.mkdirSync(onnxDir, { recursive: true });
    
    // Create minimal mock files that will pass the existence check
    const mockFiles = {
      'config.json': '{"model_type": "bert"}',
      'tokenizer_config.json': '{"model_max_length": 512}',
      'tokenizer.json': '{"version": "1.0"}',
      'special_tokens_map.json': '{"unk_token": "[UNK]"}',
      'onnx/model_quantized.onnx': Buffer.from('mock-onnx-data')
    };
    
    for (const [filePath, content] of Object.entries(mockFiles)) {
      const fullPath = path.join(modelDir, filePath);
      fs.writeFileSync(fullPath, content);
      console.log('[TEST] Created mock file:', fullPath);
    }
    
    // Launch app with model already present
    const app = await electron.launch({
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SINGLETON: 'true',
        NODE_ENV: 'test',
        USER_DATA_PATH: testDir,
        TRANSFORMERS_CACHE: path.join(testDir, 'models'),
        HOME: testDir,
        APPDATA: testDir,
        XDG_CACHE_HOME: testDir
      }
    });
    
    try {
      const window = await app.firstWindow();
      console.log('[TEST] Window opened with existing model');
      
      // Should NOT show download dialog
      const downloadDialog = window.locator('text=Downloading AI Model');
      
      // Give it a moment to potentially show the dialog
      await window.waitForTimeout(3000);
      
      // Verify download dialog is not visible
      await expect(downloadDialog).not.toBeVisible();
      console.log('[TEST] No download dialog - model already exists');
      
      // The app should eventually be ready (might show "Loading..." briefly)
      // Look for the search input as indicator app is ready
      const searchInput = window.locator('input[type="text"]');
      await expect(searchInput).toBeVisible({ timeout: 15000 });
      console.log('[TEST] App ready without download');
      
    } finally {
      await app.close();
    }
  });

  test('should handle missing model files gracefully', async () => {
    // Create partial model files (missing the main ONNX file)
    const modelDir = path.join(testDir, 'models', 'Xenova', 'multilingual-e5-small');
    fs.mkdirSync(modelDir, { recursive: true });
    
    // Only create config files, not the model file
    fs.writeFileSync(path.join(modelDir, 'config.json'), '{"model_type": "bert"}');
    fs.writeFileSync(path.join(modelDir, 'tokenizer.json'), '{"version": "1.0"}');
    // Deliberately don't create onnx/model_quantized.onnx
    
    const app = await electron.launch({
      args: ['dist/main.cjs'],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SINGLETON: 'true',
        NODE_ENV: 'test',
        USER_DATA_PATH: testDir,
        TRANSFORMERS_CACHE: path.join(testDir, 'models'),
        HOME: testDir,
        APPDATA: testDir,
        XDG_CACHE_HOME: testDir
      }
    });
    
    try {
      const window = await app.firstWindow();
      console.log('[TEST] Window opened with partial model files');
      
      // Should show download dialog since model is incomplete
      const downloadDialog = window.locator('text=Downloading AI Model');
      await expect(downloadDialog).toBeVisible({ timeout: 15000 });
      console.log('[TEST] Download dialog appeared for incomplete model');
      
    } finally {
      await app.close();
    }
  });
});