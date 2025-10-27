/**
 * Tests for config I/O pure functions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getDefaultConfig,
  validateAndMigrateConfig,
  readConfigFile,
  writeConfigFile,
  readConfigWithDefaults,
  AppConfig
} from './configIO';

describe('configIO', () => {
  let testDir: string;
  let testConfigPath: string;

  beforeEach(() => {
    // Create a temporary directory for test files
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    testConfigPath = path.join(testDir, 'config.json');
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getDefaultConfig', () => {
    it('returns valid default config', () => {
      const config = getDefaultConfig();

      expect(config.version).toBe('1.0.0');
      expect(config.watchedFolders).toEqual([]);
      expect(config.settings.cpuThrottle).toBe('medium');
      expect(config.settings.embeddingBatchSize).toBe(32);
      expect(config.settings.embedderPoolSize).toBe(2);
      expect(config.settings.fileTypes).toBeDefined();
    });

    it('returns fresh date for lastUpdated', () => {
      const config = getDefaultConfig();
      const date = new Date(config.lastUpdated);

      expect(date).toBeInstanceOf(Date);
      expect(date.getTime()).toBeGreaterThan(Date.now() - 1000); // Within last second
    });
  });

  describe('validateAndMigrateConfig', () => {
    it('validates complete valid config', () => {
      const validConfig = getDefaultConfig();
      validConfig.watchedFolders = ['/test/folder'];

      const result = validateAndMigrateConfig(validConfig);

      expect(result.watchedFolders).toEqual(['/test/folder']);
      expect(result.version).toBe('1.0.0');
    });

    it('fills in missing version', () => {
      const incomplete: any = {
        watchedFolders: ['/test'],
        settings: getDefaultConfig().settings
      };

      const result = validateAndMigrateConfig(incomplete);

      expect(result.version).toBe('1.0.0');
      expect(result.watchedFolders).toEqual(['/test']);
    });

    it('handles missing settings with defaults', () => {
      const incomplete: any = {
        version: '1.0.0',
        watchedFolders: []
      };

      const result = validateAndMigrateConfig(incomplete);

      expect(result.settings).toBeDefined();
      expect(result.settings.cpuThrottle).toBe('medium');
      expect(result.settings.embeddingBatchSize).toBe(32);
    });

    it('rejects invalid cpuThrottle value', () => {
      const invalid: any = {
        version: '1.0.0',
        watchedFolders: [],
        settings: {
          ...getDefaultConfig().settings,
          cpuThrottle: 'invalid'
        }
      };

      const result = validateAndMigrateConfig(invalid);

      expect(result.settings.cpuThrottle).toBe('medium'); // Falls back to default
    });

    it('handles non-array watchedFolders', () => {
      const invalid: any = {
        version: '1.0.0',
        watchedFolders: 'not-an-array'
      };

      const result = validateAndMigrateConfig(invalid);

      expect(result.watchedFolders).toEqual([]);
    });
  });

  describe('readConfigFile', () => {
    it('reads valid config file', () => {
      const testConfig = getDefaultConfig();
      testConfig.watchedFolders = ['/Users/test/Dropbox', '/Users/test/Documents'];
      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const result = readConfigFile(testConfigPath);

      expect(result).not.toBeNull();
      expect(result!.watchedFolders).toEqual(['/Users/test/Dropbox', '/Users/test/Documents']);
    });

    it('returns null for non-existent file', () => {
      const result = readConfigFile('/nonexistent/path/config.json');

      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      fs.writeFileSync(testConfigPath, 'invalid json {{{');

      const result = readConfigFile(testConfigPath);

      expect(result).toBeNull();
    });

    it('validates and migrates old format', () => {
      const oldFormat = {
        watchedFolders: ['/test'],
        // Missing version and settings
      };
      fs.writeFileSync(testConfigPath, JSON.stringify(oldFormat));

      const result = readConfigFile(testConfigPath);

      expect(result).not.toBeNull();
      expect(result!.version).toBe('1.0.0');
      expect(result!.settings).toBeDefined();
      expect(result!.watchedFolders).toEqual(['/test']);
    });
  });

  describe('writeConfigFile', () => {
    it('writes config to file', () => {
      const config = getDefaultConfig();
      config.watchedFolders = ['/test/folder'];

      writeConfigFile(testConfigPath, config);

      expect(fs.existsSync(testConfigPath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(testConfigPath, 'utf-8'));
      expect(written.watchedFolders).toEqual(['/test/folder']);
    });

    it('updates lastUpdated timestamp', () => {
      const config = getDefaultConfig();
      const oldTimestamp = '2020-01-01T00:00:00.000Z';
      config.lastUpdated = oldTimestamp;

      writeConfigFile(testConfigPath, config);

      const written = JSON.parse(fs.readFileSync(testConfigPath, 'utf-8'));
      expect(written.lastUpdated).not.toBe(oldTimestamp);
      expect(new Date(written.lastUpdated).getTime()).toBeGreaterThan(Date.now() - 1000);
    });

    it('creates formatted JSON', () => {
      const config = getDefaultConfig();

      writeConfigFile(testConfigPath, config);

      const content = fs.readFileSync(testConfigPath, 'utf-8');
      expect(content).toContain('\n'); // Check it's formatted
      expect(content).toContain('  '); // Check it has indentation
    });
  });

  describe('readConfigWithDefaults', () => {
    it('returns file config when it exists', () => {
      const testConfig = getDefaultConfig();
      testConfig.watchedFolders = ['/test/custom'];
      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig));

      const result = readConfigWithDefaults(testConfigPath);

      expect(result.watchedFolders).toEqual(['/test/custom']);
    });

    it('returns default config when file does not exist', () => {
      const result = readConfigWithDefaults('/nonexistent/config.json');

      expect(result.watchedFolders).toEqual([]);
      expect(result.version).toBe('1.0.0');
    });

    it('returns default config when file is invalid', () => {
      fs.writeFileSync(testConfigPath, 'invalid json');

      const result = readConfigWithDefaults(testConfigPath);

      expect(result.watchedFolders).toEqual([]);
      expect(result.version).toBe('1.0.0');
    });
  });

  describe('round-trip test', () => {
    it('can write and read back same config', () => {
      const original = getDefaultConfig();
      original.watchedFolders = ['/Users/bovet/Dropbox', '/Users/bovet/Documents'];
      original.settings.cpuThrottle = 'high';
      original.settings.embeddingBatchSize = 64;

      writeConfigFile(testConfigPath, original);
      const readBack = readConfigFile(testConfigPath);

      expect(readBack).not.toBeNull();
      expect(readBack!.watchedFolders).toEqual(original.watchedFolders);
      expect(readBack!.settings.cpuThrottle).toBe('high');
      expect(readBack!.settings.embeddingBatchSize).toBe(64);
    });
  });
});
