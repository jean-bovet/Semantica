/**
 * Centralized logging utility with category-based filtering.
 *
 * Usage:
 *   logger.log('WORKER', 'Starting initialization...');
 *   logger.error('INDEXING', 'Failed to parse file:', error);
 *
 * Configuration via environment variable:
 *   LOG_CATEGORIES=WORKER,INDEXING npm run dev
 *   LOG_CATEGORIES=EMBEDDER-* npm run dev  (wildcards)
 *   LOG_CATEGORIES=* npm run dev           (all categories)
 */

// All available log categories
const CATEGORIES = {
  // Core operations
  'PIPELINE-STATUS': false,  // Main progress indicator (enable with LOG_CATEGORIES)
  'ERROR': true,            // Always enabled - all errors

  // File operations
  'INDEXING': false,
  'QUEUE': false,
  'CLEANUP': false,
  'WATCHER': false,
  'FILE-STATUS': false,
  'REINDEX': false,
  'ENCODING': false,

  // Processing
  'WORKER': false,
  'PROCESS-QUEUE': false,
  'EMBEDDING': false,
  'EMBEDDING-QUEUE': false,

  // Embedder subsystem
  'EMBEDDER': false,
  'EMBEDDER-EVENT': false,
  'EMBEDDER-POOL': false,
  'ISOLATED': false,
  'IPC-ADAPTER': false,
  'EMBEDDER-CORE': false,
  'MODEL-LOADER': false,
  'NODE-MESSENGER': false,

  // Ollama integration
  'OLLAMA-SERVICE': false,
  'OLLAMA-EMBEDDER': false,
  'OLLAMA-CLIENT': false,

  // System monitoring
  'MEMORY': false,
  'PERFORMANCE': false,
  'PROFILING': false,
  'STATE-MACHINE': false,
  'CHILD-OUT': false,
  'CHILD-ERR': false,

  // Infrastructure
  'DATABASE': false,
  'STARTUP': false,
  'MOCK': false,
  'DEPRECATED': false,
};

export type LogCategory = keyof typeof CATEGORIES;

class Logger {
  private enabled: Set<string>;
  private readonly alwaysEnabled = ['ERROR'];

  constructor() {
    this.enabled = this.parseConfig();
  }

  private parseConfig(): Set<string> {
    const enabled = new Set<string>();

    // Always include these critical categories
    for (const cat of this.alwaysEnabled) {
      enabled.add(cat);
    }

    // Parse LOG_CATEGORIES environment variable
    const config = process.env.LOG_CATEGORIES?.trim();

    if (!config) {
      // Default: only show always-enabled categories
      return enabled;
    }

    if (config === '*') {
      // Enable all categories
      return new Set(Object.keys(CATEGORIES));
    }

    // Parse comma-separated list
    const categories = config.split(',').map(c => c.trim()).filter(Boolean);

    for (const cat of categories) {
      if (cat.endsWith('-*')) {
        // Wildcard matching: "EMBEDDER-*" matches all "EMBEDDER-XXX"
        const prefix = cat.slice(0, -1); // Remove the *
        for (const key of Object.keys(CATEGORIES)) {
          if (key.startsWith(prefix)) {
            enabled.add(key);
          }
        }
      } else if (cat.startsWith('-')) {
        // Exclusion: "-WORKER" removes WORKER even if included by wildcard
        enabled.delete(cat.slice(1));
      } else {
        // Direct category name
        if (CATEGORIES.hasOwnProperty(cat)) {
          enabled.add(cat);
        } else {
          // Warn about unknown category (but only once)
          if (!this.warnedCategories?.has(cat)) {
            console.warn(`[LOGGER] Unknown log category: ${cat}`);
            this.warnedCategories = this.warnedCategories || new Set();
            this.warnedCategories.add(cat);
          }
        }
      }
    }

    return enabled;
  }

  private warnedCategories?: Set<string>;

  /**
   * Log a message if the category is enabled
   */
  log(category: LogCategory | string, ...args: any[]): void {
    if (this.enabled.has(category)) {
      console.log(`[${category}]`, ...args);
    }
  }

  /**
   * Log an error (always visible regardless of category settings)
   */
  error(category: LogCategory | string, ...args: any[]): void {
    // Errors are always logged
    console.error(`[${category}]`, ...args);
  }

  /**
   * Log a warning if the category is enabled
   */
  warn(category: LogCategory | string, ...args: any[]): void {
    if (this.enabled.has(category)) {
      console.warn(`[${category}]`, ...args);
    }
  }

  /**
   * Check if a category is currently enabled
   */
  isEnabled(category: LogCategory | string): boolean {
    return this.enabled.has(category);
  }

  /**
   * Get list of currently enabled categories
   */
  getEnabledCategories(): string[] {
    return Array.from(this.enabled).sort();
  }

  /**
   * Dynamically enable a category (useful for debugging)
   */
  enableCategory(category: LogCategory | string): void {
    this.enabled.add(category);
  }

  /**
   * Dynamically disable a category
   */
  disableCategory(category: LogCategory | string): void {
    // Don't allow disabling always-enabled categories
    if (!this.alwaysEnabled.includes(category)) {
      this.enabled.delete(category);
    }
  }

  /**
   * Reset to configuration from environment variable
   */
  reset(): void {
    this.enabled = this.parseConfig();
  }

  /**
   * Log a message that should always be visible (for critical info)
   * This is equivalent to using the PIPELINE-STATUS category
   */
  info(...args: any[]): void {
    console.log('[INFO]', ...args);
  }
}

// Export singleton instance
export const logger = new Logger();

// Export for testing
export { Logger };

// Common logging presets for documentation
export const LOG_PRESETS = {
  'file-processing': 'WORKER,PROCESS-QUEUE,INDEXING,QUEUE',
  'embedder-debug': 'EMBEDDER-*,MEMORY',
  'performance': 'PERFORMANCE,PROFILING,MEMORY',
  'encoding-issues': 'ENCODING,FILE-STATUS,INDEXING',
  'progress': 'PIPELINE-STATUS',  // Show progress only
  'full-debug': '*',
  'silent': '',  // Only errors (default)
};