/**
 * Pure functions for config file I/O
 * These functions have no side effects except file system operations
 * and are easily testable with mock file systems
 */

import * as fs from 'fs';
import { ParserKey, getDefaultFileTypes } from '../../main/parsers/registry';

// Re-export types for convenience
export type FileTypes = Record<ParserKey, boolean>;

export interface AppConfig {
  version: string;
  watchedFolders: string[];
  settings: {
    cpuThrottle: 'low' | 'medium' | 'high';
    excludePatterns: string[];
    excludeBundles: boolean;
    bundlePatterns: string[];
    fileTypes: FileTypes;
    embeddingBatchSize: number;
    embedderPoolSize: number;
  };
  lastUpdated: string;
}

/**
 * Get default configuration object
 * Pure function with no side effects
 */
export function getDefaultConfig(): AppConfig {
  return {
    version: '1.0.0',
    watchedFolders: [],
    settings: {
      cpuThrottle: 'medium',
      excludePatterns: ['node_modules', '.git', '*.tmp', '.DS_Store'],
      excludeBundles: true,
      bundlePatterns: [
        '**/*.app/**',
        '**/*.framework/**',
        '**/*.bundle/**',
        '**/*.plugin/**',
        '**/*.kext/**',
        '**/*.prefPane/**',
        '**/*.qlgenerator/**',
        '**/*.dSYM/**',
        '**/*.xcodeproj/**',
        '**/*.playground/**',
        '**/*.photoslibrary/**',
        '**/*.musiclibrary/**',
        '**/*.photosLibrary/**',
        '**/*.tvlibrary/**'
      ],
      fileTypes: getDefaultFileTypes(),
      embeddingBatchSize: 32,
      embedderPoolSize: 2
    },
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Validate and migrate config object to current version
 * Pure function - returns new object, doesn't mutate input
 */
export function validateAndMigrateConfig(config: any): AppConfig {
  const defaultConfig = getDefaultConfig();

  // Start with defaults
  const validated: AppConfig = {
    ...defaultConfig,
    // Preserve existing values if valid
    version: config.version || '1.0.0',
    watchedFolders: Array.isArray(config.watchedFolders) ? config.watchedFolders : [],
    lastUpdated: config.lastUpdated || new Date().toISOString()
  };

  // Validate settings
  if (config.settings && typeof config.settings === 'object') {
    validated.settings = {
      ...defaultConfig.settings,
      cpuThrottle: ['low', 'medium', 'high'].includes(config.settings.cpuThrottle)
        ? config.settings.cpuThrottle
        : 'medium',
      excludePatterns: Array.isArray(config.settings.excludePatterns)
        ? config.settings.excludePatterns
        : defaultConfig.settings.excludePatterns,
      excludeBundles: typeof config.settings.excludeBundles === 'boolean'
        ? config.settings.excludeBundles
        : true,
      bundlePatterns: Array.isArray(config.settings.bundlePatterns)
        ? config.settings.bundlePatterns
        : defaultConfig.settings.bundlePatterns,
      fileTypes: config.settings.fileTypes || defaultConfig.settings.fileTypes,
      embeddingBatchSize: typeof config.settings.embeddingBatchSize === 'number'
        ? config.settings.embeddingBatchSize
        : 32,
      embedderPoolSize: typeof config.settings.embedderPoolSize === 'number'
        ? config.settings.embedderPoolSize
        : 2
    };
  }

  return validated;
}

/**
 * Read config file from disk
 * Returns null if file doesn't exist or can't be parsed
 * Pure function (except for file I/O side effect)
 */
export function readConfigFile(filePath: string): AppConfig | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    return validateAndMigrateConfig(parsed);
  } catch (error) {
    console.error(`Failed to read config from ${filePath}:`, error);
    return null;
  }
}

/**
 * Write config file to disk
 * Pure function (except for file I/O side effect)
 * Throws on error
 */
export function writeConfigFile(filePath: string, config: AppConfig): void {
  const updated = {
    ...config,
    lastUpdated: new Date().toISOString()
  };

  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
}

/**
 * Safely read config file with fallback to defaults
 * Combines read + default fallback logic
 */
export function readConfigWithDefaults(filePath: string): AppConfig {
  const fileConfig = readConfigFile(filePath);
  return fileConfig ?? getDefaultConfig();
}
