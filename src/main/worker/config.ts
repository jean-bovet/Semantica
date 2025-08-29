import fs from 'node:fs';
import path from 'node:path';

export interface AppConfig {
  version: string;
  watchedFolders: string[];
  settings: {
    cpuThrottle: 'low' | 'medium' | 'high';
    excludePatterns: string[];
    excludeBundles: boolean;
    bundlePatterns: string[];
    fileTypes: {
      pdf: boolean;
      txt: boolean;
      md: boolean;
      docx: boolean;
      rtf: boolean;
      doc: boolean;
    };
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
        fileTypes: {
          pdf: true,   // Safe to enable with isolated embedder
          txt: true,
          md: true,
          docx: true,
          rtf: true,
          doc: true
        }
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
        // Add bundle exclusion settings if missing
        if (config.settings.excludeBundles === undefined) {
          config.settings.excludeBundles = true;
        }
        if (!config.settings.bundlePatterns) {
          config.settings.bundlePatterns = this.getDefaultConfig().settings.bundlePatterns;
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