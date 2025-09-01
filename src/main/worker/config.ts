import fs from 'node:fs';
import path from 'node:path';
import { ParserKey, getDefaultFileTypes } from '../parsers/registry';

// Auto-generate file types from parser registry
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
    embeddingBatchSize: number;  // Number of chunks to send to model at once
    embedderPoolSize: number;     // Number of embedder processes in the pool
  };
  lastUpdated: string;
}

export class ConfigManager {
  private configPath: string;
  private config: AppConfig;

  constructor(dbDir: string) {
    this.configPath = path.join(dbDir, 'config.json');
    this.config = this.loadConfig();
  }

  private getDefaultConfig(): AppConfig {
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
        embeddingBatchSize: 32,  // Optimized batch size for embedding model
        embedderPoolSize: 2       // Use 2 embedder processes for true parallelism
      },
      lastUpdated: new Date().toISOString()
    };
  }

  private loadConfig(): AppConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(data);
        
        // Validate and migrate if needed
        if (!config.version) {
          config.version = '1.0.0';
        }
        if (!config.settings) {
          config.settings = this.getDefaultConfig().settings;
        }
        // Add file types if missing
        if (!config.settings.fileTypes) {
          config.settings.fileTypes = this.getDefaultConfig().settings.fileTypes;
        }
        
        // Auto-migrate any new parsers from registry
        const defaultFileTypes = getDefaultFileTypes();
        let needsSave = false;
        
        // Add any missing parsers with their default values
        for (const [key, defaultEnabled] of Object.entries(defaultFileTypes)) {
          if (config.settings.fileTypes[key as ParserKey] === undefined) {
            config.settings.fileTypes[key as ParserKey] = defaultEnabled;
            needsSave = true;
            console.log(`Added new parser '${key}' to config with default value: ${defaultEnabled}`);
          }
        }
        
        // Remove any obsolete parsers that are no longer in registry
        for (const key of Object.keys(config.settings.fileTypes)) {
          if (!(key in defaultFileTypes)) {
            delete config.settings.fileTypes[key as ParserKey];
            needsSave = true;
            console.log(`Removed obsolete parser '${key}' from config`);
          }
        }
        // Add bundle exclusion settings if missing
        if (config.settings.excludeBundles === undefined) {
          config.settings.excludeBundles = true;
          needsSave = true;
        }
        if (!config.settings.bundlePatterns) {
          config.settings.bundlePatterns = this.getDefaultConfig().settings.bundlePatterns;
          needsSave = true;
        }
        
        // Add performance optimization settings if missing
        if (config.settings.embeddingBatchSize === undefined) {
          config.settings.embeddingBatchSize = 32;
          needsSave = true;
        }
        // Remove obsolete parallelBatches setting if it exists
        if ('parallelBatches' in config.settings) {
          delete (config.settings as any).parallelBatches;
          needsSave = true;
        }
        if (config.settings.embedderPoolSize === undefined) {
          config.settings.embedderPoolSize = 2;
          needsSave = true;
        }
        
        // Save if we made any changes
        if (needsSave) {
          this.saveConfig(config);
        }
        
        return config;
      }
    } catch (error) {
      console.error('Failed to load config, using defaults:', error);
    }
    
    // Create default config
    const defaultConfig = this.getDefaultConfig();
    this.saveConfig(defaultConfig);
    return defaultConfig;
  }

  private saveConfig(config: AppConfig): void {
    try {
      config.lastUpdated = new Date().toISOString();
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Failed to save config:', error);
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