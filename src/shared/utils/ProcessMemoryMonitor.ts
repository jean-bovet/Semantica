import { execSync as nodeExecSync } from 'child_process';

/**
 * Memory usage information for a process
 */
export interface ProcessMemoryInfo {
  rss: number;  // Resident Set Size in MB
  vsz: number;  // Virtual Size in MB
  pid: number;
  timestamp: number;
}

/**
 * Dependencies that can be injected for testing
 */
export interface ProcessMemoryDependencies {
  execSync?: (command: string, options?: { encoding?: BufferEncoding; timeout?: number }) => string;
}

/**
 * Configuration for memory monitoring
 */
export interface MemoryMonitorConfig {
  maxMemoryMB: number;
  warningThresholdPercent?: number;
  checkIntervalMS?: number;
  platform?: NodeJS.Platform;
  dependencies?: ProcessMemoryDependencies;
}

/**
 * Memory monitoring result
 */
export interface MemoryCheckResult {
  current: ProcessMemoryInfo | null;
  shouldRestart: boolean;
  warningLevel: boolean;
  reason?: string;
}

/**
 * Utility class for monitoring process memory usage across platforms.
 * Provides memory-based restart recommendations and health monitoring.
 */
export class ProcessMemoryMonitor {
  private readonly config: MemoryMonitorConfig;
  private readonly execSync: ProcessMemoryDependencies['execSync'];
  private lastCheck: ProcessMemoryInfo | null = null;
  private checkCount = 0;

  constructor(config: MemoryMonitorConfig) {
    this.config = {
      warningThresholdPercent: 80,
      checkIntervalMS: 10000,
      platform: process.platform,
      ...config
    };

    // Set up dependencies with defaults
    this.execSync = config.dependencies?.execSync || (nodeExecSync as any);

    if (this.config.maxMemoryMB <= 0) {
      throw new Error('maxMemoryMB must be greater than 0');
    }
  }

  /**
   * Get current memory usage for a specific process
   *
   * @param pid - Process ID to monitor
   * @returns Memory information or null if unavailable
   */
  async getMemoryUsage(pid: number): Promise<ProcessMemoryInfo | null> {
    if (!pid || pid <= 0) {
      return null;
    }

    try {
      const memInfo = await this.getPlatformMemoryInfo(pid);
      this.lastCheck = memInfo;
      this.checkCount++;
      return memInfo;
    } catch (error) {
      console.warn(`Failed to get memory info for PID ${pid}:`, error);
      return null;
    }
  }

  /**
   * Check if process should restart based on memory usage
   *
   * @param pid - Process ID to check
   * @param fileCount - Number of files processed (for additional restart criteria)
   * @returns Memory check result with restart recommendation
   */
  async checkMemoryAndRestart(
    pid: number
  ): Promise<MemoryCheckResult> {
    const current = await this.getMemoryUsage(pid);

    if (!current) {
      return {
        current: null,
        shouldRestart: false,
        warningLevel: false,
        reason: 'Unable to get memory information'
      };
    }

    const memoryPercent = (current.rss / this.config.maxMemoryMB) * 100;
    const warningThreshold = this.config.warningThresholdPercent!;

    // Check if we should restart due to high memory usage
    const shouldRestart = current.rss >= this.config.maxMemoryMB;
    const warningLevel = memoryPercent >= warningThreshold;

    let reason: string | undefined;
    if (shouldRestart) {
      reason = `Memory usage ${current.rss}MB exceeds limit ${this.config.maxMemoryMB}MB`;
    } else if (warningLevel) {
      reason = `Memory usage at ${memoryPercent.toFixed(1)}% of limit`;
    }

    return {
      current,
      shouldRestart,
      warningLevel,
      reason
    };
  }

  /**
   * Get memory usage history and statistics
   */
  getStats(): {
    lastCheck: ProcessMemoryInfo | null;
    checkCount: number;
    maxMemoryMB: number;
    warningThresholdMB: number;
  } {
    const warningThresholdMB =
      (this.config.maxMemoryMB * this.config.warningThresholdPercent!) / 100;

    return {
      lastCheck: this.lastCheck,
      checkCount: this.checkCount,
      maxMemoryMB: this.config.maxMemoryMB,
      warningThresholdMB
    };
  }

  /**
   * Reset monitoring statistics
   */
  reset(): void {
    this.lastCheck = null;
    this.checkCount = 0;
  }

  /**
   * Get platform-specific memory information
   */
  private async getPlatformMemoryInfo(pid: number): Promise<ProcessMemoryInfo> {
    const platform = this.config.platform!;

    switch (platform) {
      case 'darwin':
      case 'linux':
        return this.getUnixMemoryInfo(pid);

      case 'win32':
        return this.getWindowsMemoryInfo(pid);

      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Get memory info on Unix-like systems (macOS, Linux)
   */
  private getUnixMemoryInfo(pid: number): ProcessMemoryInfo {
    try {
      // Use ps command to get RSS and VSZ in KB
      const result = this.execSync!(`ps -o rss=,vsz= -p ${pid}`, {
        encoding: 'utf8',
        timeout: 5000
      });

      const [rssKB, vszKB] = result.trim().split(/\s+/).map(Number);

      if (isNaN(rssKB) || isNaN(vszKB)) {
        throw new Error(`Invalid ps output: ${result}`);
      }

      return {
        rss: rssKB / 1024, // Convert KB to MB
        vsz: vszKB / 1024, // Convert KB to MB
        pid,
        timestamp: Date.now()
      };
    } catch (error) {
      throw new Error(`Failed to get Unix memory info: ${error}`);
    }
  }

  /**
   * Get memory info on Windows systems
   */
  private getWindowsMemoryInfo(pid: number): ProcessMemoryInfo {
    try {
      // Use tasklist command to get memory info
      const result = this.execSync!(
        `tasklist /fi "PID eq ${pid}" /fo csv | findstr "${pid}"`,
        {
          encoding: 'utf8',
          timeout: 5000
        }
      );

      // Parse CSV output: "Image Name","PID","Session Name","Session#","Mem Usage"
      const fields = result.trim().split('","');
      if (fields.length < 5) {
        throw new Error(`Invalid tasklist output: ${result}`);
      }

      // Memory usage is in the format "1,234 K" - need to parse it
      const memUsageStr = fields[4].replace(/"/g, '').replace(/,/g, '');
      const memKB = parseInt(memUsageStr.replace(/[^\d]/g, ''), 10);

      if (isNaN(memKB)) {
        throw new Error(`Could not parse memory usage: ${fields[4]}`);
      }

      return {
        rss: memKB / 1024, // Convert KB to MB
        vsz: memKB / 1024, // Windows doesn't distinguish VSZ, use same value
        pid,
        timestamp: Date.now()
      };
    } catch (error) {
      throw new Error(`Failed to get Windows memory info: ${error}`);
    }
  }

  /**
   * Create a memory monitor with sensible defaults for embedder processes
   */
  static forEmbedder(maxMemoryMB = 1500): ProcessMemoryMonitor {
    return new ProcessMemoryMonitor({
      maxMemoryMB,
      warningThresholdPercent: 85,
      checkIntervalMS: 5000
    });
  }

  /**
   * Create a memory monitor for worker processes
   */
  static forWorker(maxMemoryMB = 800): ProcessMemoryMonitor {
    return new ProcessMemoryMonitor({
      maxMemoryMB,
      warningThresholdPercent: 90,
      checkIntervalMS: 15000
    });
  }
}