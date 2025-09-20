import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '../../../src/main/worker/services/config-service';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * ConfigService Unit Tests
 * 
 * Testing with REAL configuration files - NO MOCKING
 * Uses temporary directories for complete isolation
 */

describe('ConfigService', () => {
  let service: ConfigService;
  let tempDir: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    service = new ConfigService();
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Configuration Loading', () => {
    test('should load configuration', () => {
      expect(() => service.load(tempDir)).not.toThrow();
      
      const config = service.getConfig();
      expect(config).toBeDefined();
      expect(config.version).toBeDefined();
      expect(config.settings).toBeDefined();
    });

    test('should create default config if none exists', () => {
      service.load(tempDir);
      
      // Check that config file was created
      const configPath = path.join(tempDir, 'config.json');
      expect(fs.existsSync(configPath)).toBe(true);
      
      // Verify default settings
      const settings = service.getSettings();
      expect(settings.cpuThrottle).toBe('medium');
      expect(settings.embeddingBatchSize).toBe(32);
      expect(settings.embedderPoolSize).toBe(2);
    });

    test('should load existing config file', () => {
      // Create a config file first
      const configPath = path.join(tempDir, 'config.json');
      const customConfig = {
        version: '2.0.0',
        watchedFolders: ['/test/folder'],
        settings: {
          cpuThrottle: 'high',
          excludePatterns: ['*.test'],
          excludeBundles: false,
          bundlePatterns: [],
          fileTypes: { txt: true, pdf: false },
          embeddingBatchSize: 64,
          embedderPoolSize: 4
        },
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(configPath, JSON.stringify(customConfig, null, 2));
      
      // Load the config
      service.load(tempDir);
      
      const settings = service.getSettings();
      expect(settings.cpuThrottle).toBe('high');
      expect(settings.embeddingBatchSize).toBe(64);
      expect(settings.embedderPoolSize).toBe(4);
    });

    test('should throw when accessing config before loading', () => {
      expect(() => service.getConfig()).toThrow('Configuration not loaded');
      expect(() => service.getSettings()).toThrow('Configuration not loaded');
    });
  });

  describe('Settings Management', () => {
    beforeEach(() => {
      service.load(tempDir);
    });

    test('should update settings', () => {
      const newSettings = {
        cpuThrottle: 'low' as const,
        embeddingBatchSize: 16
      };
      
      service.updateSettings(newSettings);
      
      const settings = service.getSettings();
      expect(settings.cpuThrottle).toBe('low');
      expect(settings.embeddingBatchSize).toBe(16);
    });

    test('should persist settings changes', () => {
      service.updateSettings({ cpuThrottle: 'high' as const });
      
      // Create new service instance
      const service2 = new ConfigService();
      service2.load(tempDir);
      
      const settings = service2.getSettings();
      expect(settings.cpuThrottle).toBe('high');
    });

    test('should merge partial settings updates', () => {
      const originalSettings = service.getSettings();
      const originalBatchSize = originalSettings.embeddingBatchSize;
      
      // Update only one setting
      service.updateSettings({ cpuThrottle: 'low' as const });
      
      const settings = service.getSettings();
      expect(settings.cpuThrottle).toBe('low');
      expect(settings.embeddingBatchSize).toBe(originalBatchSize); // Unchanged
    });
  });

  describe('Watched Folders', () => {
    beforeEach(() => {
      service.load(tempDir);
    });

    test('should get empty watched folders initially', () => {
      const folders = service.getWatchedFolders();
      expect(folders).toEqual([]);
    });

    test('should set watched folders', () => {
      const folders = ['/path/one', '/path/two'];
      
      service.setWatchedFolders(folders);
      
      expect(service.getWatchedFolders()).toEqual(folders);
    });

    test('should persist watched folders', () => {
      const folders = ['/persistent/path'];
      service.setWatchedFolders(folders);
      
      // Create new service instance
      const service2 = new ConfigService();
      service2.load(tempDir);
      
      expect(service2.getWatchedFolders()).toEqual(folders);
    });

    test('should return empty array when config not loaded', () => {
      const newService = new ConfigService();
      expect(newService.getWatchedFolders()).toEqual([]);
    });
  });

  describe('Exclude Patterns', () => {
    beforeEach(() => {
      service.load(tempDir);
    });

    test('should get effective exclude patterns', () => {
      const patterns = service.getEffectiveExcludePatterns();
      
      // Should include system patterns
      expect(patterns).toContain('**/node_modules/**');
      expect(patterns).toContain('**/.git/**');
      expect(patterns).toContain('**/dist/**');
      expect(patterns).toContain('**/build/**');
    });

    test('should include custom exclude patterns', () => {
      service.updateSettings({
        excludePatterns: ['*.custom', 'temp/**']
      });
      
      const patterns = service.getEffectiveExcludePatterns();
      
      // Should include both system and custom patterns
      expect(patterns).toContain('**/node_modules/**');
      expect(patterns).toContain('*.custom');
      expect(patterns).toContain('temp/**');
    });

    test('should return empty array when config not loaded', () => {
      const newService = new ConfigService();
      expect(newService.getEffectiveExcludePatterns()).toEqual([]);
    });
  });

  describe('File Type Checks', () => {
    beforeEach(() => {
      service.load(tempDir);
      
      // Set up known file types
      service.updateSettings({
        fileTypes: {
          txt: true,
          pdf: true,
          doc: false,
          jpg: false
        } as any
      });
    });

    test('should check if file type is enabled', () => {
      expect(service.isFileTypeEnabled('.txt')).toBe(true);
      expect(service.isFileTypeEnabled('txt')).toBe(true);
      expect(service.isFileTypeEnabled('.pdf')).toBe(true);
      expect(service.isFileTypeEnabled('.doc')).toBe(false);
      expect(service.isFileTypeEnabled('.jpg')).toBe(false);
    });

    test('should handle unknown file types', () => {
      expect(service.isFileTypeEnabled('.xyz')).toBe(false);
    });

    test('should handle case-insensitive extensions', () => {
      expect(service.isFileTypeEnabled('.TXT')).toBe(true);
      expect(service.isFileTypeEnabled('.PDF')).toBe(true);
    });
  });

  describe('Configuration Helpers', () => {
    beforeEach(() => {
      service.load(tempDir);
    });

    test('should return max file size', () => {
      const maxSize = service.getMaxFileSize();
      expect(maxSize).toBe(50 * 1024 * 1024); // 50MB
    });

    test('should return concurrent indexing limit', () => {
      const limit = service.getConcurrentIndexing();
      expect(limit).toBe(5);
    });

    test('should return chunk size', () => {
      const chunkSize = service.getChunkSize();
      expect(chunkSize).toBe(1000);
    });

    test('should return chunk overlap', () => {
      const overlap = service.getChunkOverlap();
      expect(overlap).toBe(200);
    });
  });

  describe('Error Handling', () => {
    test('should throw when updating settings before loading', () => {
      expect(() => 
        service.updateSettings({ cpuThrottle: 'low' as const })
      ).toThrow('Configuration not loaded');
    });

    test('should throw when setting watched folders before loading', () => {
      expect(() => 
        service.setWatchedFolders(['/path'])
      ).toThrow('Configuration not loaded');
    });

    test('should handle corrupted config file gracefully', () => {
      // Create corrupted config
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, 'not valid json');
      
      // Should create default config
      expect(() => service.load(tempDir)).not.toThrow();
      
      const settings = service.getSettings();
      expect(settings.cpuThrottle).toBe('medium'); // Default value
    });
  });

  describe('Multiple Instances', () => {
    test('should share configuration between instances', () => {
      const service1 = new ConfigService();
      const service2 = new ConfigService();
      
      service1.load(tempDir);
      service1.updateSettings({ cpuThrottle: 'high' as const });
      
      service2.load(tempDir);
      
      expect(service2.getSettings().cpuThrottle).toBe('high');
    });

    test('should handle concurrent updates', () => {
      const service1 = new ConfigService();
      const service2 = new ConfigService();
      
      service1.load(tempDir);
      service2.load(tempDir);
      
      // Both update different settings
      service1.updateSettings({ cpuThrottle: 'low' as const });
      service2.updateSettings({ embeddingBatchSize: 64 });
      
      // Reload to get latest
      const service3 = new ConfigService();
      service3.load(tempDir);
      
      const settings = service3.getSettings();
      // Should have the last write
      expect(settings.embeddingBatchSize).toBe(64);
    });
  });

  describe('Performance', () => {
    test('should handle rapid configuration updates', () => {
      service.load(tempDir);
      
      const startTime = Date.now();
      
      // Perform many rapid updates
      for (let i = 0; i < 100; i++) {
        service.updateSettings({
          cpuThrottle: i % 2 === 0 ? 'low' : 'high' as const
        });
      }
      
      const duration = Date.now() - startTime;
      
      // Should complete quickly (under 1 second for 100 updates)
      expect(duration).toBeLessThan(1000);
      
      // Final value should be persisted
      const service2 = new ConfigService();
      service2.load(tempDir);
      expect(service2.getSettings().cpuThrottle).toBe('low'); // Last value (99 is odd, so 98 is even = low)
    });
  });
});

/**
 * This test suite demonstrates:
 * 
 * 1. REAL FILES - Uses actual configuration files in temp directories
 * 2. NO MOCKING - ConfigManager and file I/O are real
 * 3. ISOLATION - Each test gets its own config directory
 * 4. PERSISTENCE - Tests actual file persistence
 * 5. COMPREHENSIVE - Tests all ConfigService methods
 * 6. CONCURRENT - Tests multiple instances and updates
 * 
 * The tests prove configuration management works correctly with real files.
 */