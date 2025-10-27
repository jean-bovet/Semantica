import path from 'node:path';
import { logger } from '../../shared/utils/logger';
import {
  AppConfig,
  readConfigWithDefaults,
  writeConfigFile
} from '../../shared/config/configIO';

// Re-export types for backward compatibility
export type { AppConfig, FileTypes } from '../../shared/config/configIO';

/**
 * ConfigManager - Simplified using pure functions from configIO
 * Now just a thin wrapper for config I/O with logging
 */
export class ConfigManager {
  private configPath: string;
  private config: AppConfig;

  constructor(dbDir: string) {
    this.configPath = path.join(dbDir, 'config.json');
    logger.log('CONFIG', `Loading config from: ${this.configPath}`);

    // Use pure function to read config with defaults
    this.config = readConfigWithDefaults(this.configPath);

    logger.log('CONFIG', `Config loaded. Watched folders: ${JSON.stringify(this.config.watchedFolders)}`);
    logger.log('CONFIG', `Settings: cpuThrottle=${this.config.settings.cpuThrottle}, batchSize=${this.config.settings.embeddingBatchSize}`);
  }

  private saveConfig(config: AppConfig): void {
    try {
      writeConfigFile(this.configPath, config);
      logger.log('CONFIG', `Config saved to: ${this.configPath}`);
    } catch (error) {
      logger.error('CONFIG', 'Failed to save config:', error);
    }
  }

  getWatchedFolders(): string[] {
    return this.config.watchedFolders || [];
  }

  setWatchedFolders(folders: string[]): void {
    this.config.watchedFolders = folders;
    this.saveConfig(this.config);
  }

  getSettings() {
    return this.config.settings;
  }

  updateSettings(settings: Partial<AppConfig['settings']>): void {
    this.config.settings = { ...this.config.settings, ...settings };
    this.saveConfig(this.config);
  }

  getConfig(): AppConfig {
    return this.config;
  }

  getEffectiveExcludePatterns(): string[] {
    const patterns = [...this.config.settings.excludePatterns];
    
    if (this.config.settings.excludeBundles) {
      patterns.push(...this.config.settings.bundlePatterns);
    }
    
    return patterns;
  }
}