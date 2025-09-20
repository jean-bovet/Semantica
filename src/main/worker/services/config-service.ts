/**
 * ConfigService - Manages application configuration
 *
 * This service handles loading, saving, and accessing configuration
 * settings for the worker process.
 */

import type { IConfigService } from '../types/interfaces';
import type { AppConfig } from '../config';
import { ConfigManager } from '../config';
import { logger } from '../../../shared/utils/logger';

export class ConfigService implements IConfigService {
  private configManager: ConfigManager | null = null;

  load(dbDir: string): void {
    this.configManager = new ConfigManager(dbDir);
    logger.log('CONFIG', 'Configuration loaded');
  }

  getConfig(): AppConfig {
    if (!this.configManager) {
      throw new Error('Configuration not loaded');
    }
    return this.configManager.getConfig();
  }

  getSettings(): AppConfig['settings'] {
    if (!this.configManager) {
      throw new Error('Configuration not loaded');
    }
    return this.configManager.getSettings();
  }

  updateSettings(settings: Partial<AppConfig['settings']>): void {
    if (!this.configManager) {
      throw new Error('Configuration not loaded');
    }

    this.configManager.updateSettings(settings);
    logger.log('CONFIG', 'Settings updated');
  }

  getWatchedFolders(): string[] {
    if (!this.configManager) {
      return [];
    }
    return this.configManager.getWatchedFolders();
  }

  setWatchedFolders(folders: string[]): void {
    if (!this.configManager) {
      throw new Error('Configuration not loaded');
    }

    this.configManager.setWatchedFolders(folders);
    logger.log('CONFIG', `Updated watched folders: ${folders.length} folders`);
  }

  getEffectiveExcludePatterns(): string[] {
    if (!this.configManager) {
      return [];
    }
    return this.configManager.getEffectiveExcludePatterns();
  }

  // Helper methods
  isFileTypeEnabled(extension: string): boolean {
    const settings = this.getSettings();
    const ext = extension.toLowerCase().replace('.', '');

    // Check against fileTypes configuration
    const fileTypes = settings.fileTypes || {};
    return fileTypes[ext as keyof typeof fileTypes] || false;
  }

  getMaxFileSize(): number {
    // Default 50MB max file size
    return 50 * 1024 * 1024;
  }

  getConcurrentIndexing(): number {
    // Default to 5 concurrent indexing operations
    return 5;
  }

  getChunkSize(): number {
    // Default chunk size of 1000 characters
    return 1000;
  }

  getChunkOverlap(): number {
    // Default chunk overlap of 200 characters
    return 200;
  }
}