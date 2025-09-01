import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from '../src/main/worker/config';

describe('ConfigManager', () => {
  let tempDir: string;
  let configManager: ConfigManager;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create default config if none exists', () => {
    configManager = new ConfigManager(tempDir);
    
    const config = configManager.getConfig();
    expect(config.version).toBe('1.0.0');
    expect(config.watchedFolders).toEqual([]);
    expect(config.settings.cpuThrottle).toBe('medium');
    expect(config.settings.excludePatterns).toContain('node_modules');
    
    // Check that config file was created
    const configPath = path.join(tempDir, 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it('should load existing config from disk', () => {
    const configPath = path.join(tempDir, 'config.json');
    const existingConfig = {
      version: '1.0.0',
      watchedFolders: ['/test/folder1', '/test/folder2'],
      settings: {
        cpuThrottle: 'high',
        excludePatterns: ['.git']
      },
      lastUpdated: new Date().toISOString()
    };
    
    fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));
    
    configManager = new ConfigManager(tempDir);
    const config = configManager.getConfig();
    
    expect(config.watchedFolders).toEqual(['/test/folder1', '/test/folder2']);
    expect(config.settings.cpuThrottle).toBe('high');
  });

  it('should persist watched folders', () => {
    configManager = new ConfigManager(tempDir);
    
    const folders = ['/Users/test/Documents', '/Users/test/Desktop'];
    configManager.setWatchedFolders(folders);
    
    expect(configManager.getWatchedFolders()).toEqual(folders);
    
    // Create a new instance to verify persistence
    const newConfigManager = new ConfigManager(tempDir);
    expect(newConfigManager.getWatchedFolders()).toEqual(folders);
  });

  it('should update settings', () => {
    configManager = new ConfigManager(tempDir);
    
    configManager.updateSettings({ cpuThrottle: 'low' });
    expect(configManager.getSettings().cpuThrottle).toBe('low');
    
    // Verify other settings are not affected
    expect(configManager.getSettings().excludePatterns).toContain('node_modules');
  });

  it('should handle corrupted config gracefully', () => {
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, 'invalid json {');
    
    // Should not throw and should use defaults
    configManager = new ConfigManager(tempDir);
    const config = configManager.getConfig();
    
    expect(config.version).toBe('1.0.0');
    expect(config.watchedFolders).toEqual([]);
  });

  it('should migrate old config format', () => {
    const configPath = path.join(tempDir, 'config.json');
    const oldConfig = {
      watchedFolders: ['/old/folder'],
      lastUpdated: '2024-01-01'
    };
    
    fs.writeFileSync(configPath, JSON.stringify(oldConfig, null, 2));
    
    configManager = new ConfigManager(tempDir);
    const config = configManager.getConfig();
    
    // Should add missing fields
    expect(config.version).toBe('1.0.0');
    expect(config.settings).toBeDefined();
    expect(config.settings.cpuThrottle).toBe('medium');
    expect(config.watchedFolders).toEqual(['/old/folder']);
  });

  it('should update lastUpdated timestamp on save', () => {
    configManager = new ConfigManager(tempDir);
    const initialTime = configManager.getConfig().lastUpdated;
    
    // Wait a bit to ensure timestamp difference
    setTimeout(() => {
      configManager.setWatchedFolders(['/new/folder']);
      const newTime = configManager.getConfig().lastUpdated;
      
      expect(new Date(newTime).getTime()).toBeGreaterThan(new Date(initialTime).getTime());
    }, 10);
  });
});