/**
 * PythonSidecarService - Lifecycle management for Python embedding sidecar
 *
 * Handles automatic startup, health monitoring, and shutdown of the Python
 * FastAPI embedding server. The sidecar runs as a child process and provides
 * embedding generation via HTTP API.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { PythonSidecarClient } from './PythonSidecarClient';
import { logger } from '../../shared/utils/logger';

// Helper to log with category
const log = (message: string, ...args: any[]) => logger.log('SIDECAR-SERVICE', message, ...args);

/**
 * Progress events emitted by Python sidecar during model loading
 */
export interface DownloadProgressEvent {
  type: 'download_started' | 'model_cached' | 'model_loaded';
  data: {
    model?: string;
    dimensions?: number;
  };
}

export interface PythonSidecarServiceConfig {
  client?: PythonSidecarClient;
  pythonPath?: string;      // Path to Python interpreter
  scriptPath?: string;      // Path to embed_server.py
  port?: number;            // Port to run sidecar on
  autoRestart?: boolean;    // Auto-restart on crash
  maxStartupTime?: number;  // Max time to wait for startup (ms)
  onProgress?: (event: DownloadProgressEvent) => void; // Progress callback
}

export interface SidecarStatus {
  running: boolean;
  pid: number | null;
  port: number;
  healthy: boolean;
}

/**
 * Service for managing Python sidecar lifecycle
 */
export class PythonSidecarService {
  private client: PythonSidecarClient;
  private pythonPath: string;
  private scriptPath: string;
  private port: number;
  private autoRestart: boolean;
  private maxStartupTime: number;
  private process: ChildProcess | null = null;
  private isShuttingDown: boolean = false;
  private progressCallback?: (event: DownloadProgressEvent) => void;
  private restartCount: number = 0;
  private readonly MAX_RESTARTS = 3;

  constructor(config: PythonSidecarServiceConfig = {}) {
    this.client = config.client || new PythonSidecarClient({ port: config.port });
    this.port = config.port || 8421;
    this.autoRestart = config.autoRestart !== false; // Default true
    this.maxStartupTime = config.maxStartupTime || 30000; // 30s
    this.progressCallback = config.onProgress;

    // Determine Python path (development vs production)
    this.pythonPath = config.pythonPath || this.getDefaultPythonPath();

    // Determine script path (development vs production)
    this.scriptPath = config.scriptPath || this.getDefaultScriptPath();
  }

  /**
   * Check if Python dependencies are installed
   * @returns Object with dependency status or null if check failed
   */
  async checkDependencies(): Promise<{
    all_present: boolean;
    python_version: string;
    deps: Record<string, boolean>;
    missing?: string[];
    error?: string;
  } | null> {
    const startTime = Date.now();
    log('⏱️  [TIMING] Dependency check started');

    return new Promise((resolve) => {
      const projectRoot = this.getProjectRoot();
      const checkScript = path.join(projectRoot, 'embedding_sidecar/check_deps.py');

      // Check if check script exists
      if (!fs.existsSync(checkScript)) {
        log('Dependency check script not found, skipping pre-flight check');
        resolve(null);
        return;
      }

      const proc = spawn(this.pythonPath, [checkScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.getPythonEnv()
      });

      let output = '';
      let errorOutput = '';

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      proc.on('exit', (code) => {
        const duration = Date.now() - startTime;
        try {
          const result = JSON.parse(output.trim());
          if (code === 0) {
            log(`⏱️  [TIMING] Dependency check completed in ${duration}ms - all dependencies present`);
          } else {
            log(`⏱️  [TIMING] Dependency check completed in ${duration}ms - missing:`, result.missing || []);
          }
          resolve(result);
        } catch (err) {
          log(`⏱️  [TIMING] Dependency check failed after ${duration}ms:`, err);
          if (errorOutput) {
            log('Dependency check stderr:', errorOutput);
          }
          resolve(null);
        }
      });

      proc.on('error', (error) => {
        const duration = Date.now() - startTime;
        log(`⏱️  [TIMING] Dependency check error after ${duration}ms: ${error.message}`);
        resolve(null);
      });
    });
  }

  /**
   * Start the Python sidecar server
   */
  async startSidecar(): Promise<boolean> {
    if (this.process) {
      log('Sidecar already running');
      return true;
    }

    const startupStartTime = Date.now();
    log(`⏱️  [TIMING] Starting Python sidecar on port ${this.port}...`);
    log(`Python path: ${this.pythonPath}`);
    log(`Script path: ${this.scriptPath}`);

    try {
      // Spawn Python process
      const spawnStartTime = Date.now();
      this.process = spawn(this.pythonPath, [
        this.scriptPath,
        '--port', this.port.toString()
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.getPythonEnv()
      });
      const spawnDuration = Date.now() - spawnStartTime;
      log(`⏱️  [TIMING] Python process spawned in ${spawnDuration}ms (PID: ${this.process.pid})`);

      // Handle stdout - parse progress events and regular output
      this.process.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        const lines = output.split('\n');

        for (const line of lines) {
          if (!line) continue;

          // Parse progress events (format: PROGRESS:{"type":"...","data":{...}})
          if (line.startsWith('PROGRESS:')) {
            try {
              const jsonStr = line.substring('PROGRESS:'.length);
              const event = JSON.parse(jsonStr) as DownloadProgressEvent;

              log(`Progress event: ${event.type}`, event.data);

              // Forward to callback if registered
              if (this.progressCallback) {
                this.progressCallback(event);
              }
            } catch (err) {
              logger.error('SIDECAR-SERVICE', 'Failed to parse progress event:', err);
            }
          } else {
            // Regular stdout output
            logger.log('SIDECAR-STDOUT', line);
          }
        }
      });

      // Handle stderr
      this.process.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          logger.log('SIDECAR-STDERR', output);
        }
      });

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        log(`Sidecar process exited with code ${code}, signal ${signal}`);
        this.process = null;

        // Auto-restart if enabled and not shutting down
        if (this.autoRestart && !this.isShuttingDown) {
          this.restartCount++;

          if (this.restartCount >= this.MAX_RESTARTS) {
            logger.error('SIDECAR-SERVICE', `❌ Sidecar crashed ${this.MAX_RESTARTS} times, disabling auto-restart`);
            logger.error('SIDECAR-SERVICE', 'Check logs above for errors. Common issues:');
            logger.error('SIDECAR-SERVICE', '  - Script not found: Verify embedding_sidecar/embed_server.py exists');
            logger.error('SIDECAR-SERVICE', '  - Dependencies missing: Run pip install -r requirements.txt');
            logger.error('SIDECAR-SERVICE', '  - Port in use: Check if another process is using port ' + this.port);
            this.autoRestart = false; // Disable further restarts
            return;
          }

          log(`Auto-restarting sidecar in 2s... (attempt ${this.restartCount}/${this.MAX_RESTARTS})`);
          setTimeout(() => this.startSidecar(), 2000);
        }
      });

      // Handle process error
      this.process.on('error', (error) => {
        log(`Sidecar process error: ${error}`);
        this.process = null;
      });

      // Wait for sidecar to be ready (health check loop)
      log(`⏱️  [TIMING] Starting health check polling...`);
      const healthCheckStartTime = Date.now();
      const isReady = await this.waitForReady();
      const healthCheckDuration = Date.now() - healthCheckStartTime;

      if (isReady) {
        const totalDuration = Date.now() - startupStartTime;
        log(`⏱️  [TIMING] Health check passed in ${healthCheckDuration}ms`);
        log(`⏱️  [TIMING] Total sidecar startup: ${totalDuration}ms`);
        log('✅ Python sidecar started successfully');
        this.restartCount = 0; // Reset counter on successful start
        return true;
      } else {
        const totalDuration = Date.now() - startupStartTime;
        log(`⏱️  [TIMING] Health check timeout after ${healthCheckDuration}ms`);
        log(`⏱️  [TIMING] Total time before failure: ${totalDuration}ms`);
        log('❌ Python sidecar failed to start (health check timeout)');
        await this.stopSidecar();
        return false;
      }
    } catch (error) {
      const totalDuration = Date.now() - startupStartTime;
      log(`⏱️  [TIMING] Failed to start after ${totalDuration}ms: ${error}`);
      this.process = null;
      return false;
    }
  }

  /**
   * Stop the Python sidecar server
   */
  async stopSidecar(): Promise<void> {
    if (!this.process) {
      log('Sidecar not running');
      return;
    }

    log('Stopping Python sidecar...');
    this.isShuttingDown = true;

    try {
      // Try graceful shutdown first
      this.process.kill('SIGTERM');

      // Wait for graceful shutdown (shorter timeout in test/production for faster teardown)
      const shutdownTimeout = process.env.NODE_ENV === 'production' ? 1000 : 5000;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process) {
            log('Graceful shutdown timeout, forcing kill...');
            this.process.kill('SIGKILL');
          }
          resolve();
        }, shutdownTimeout);

        if (this.process) {
          this.process.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        } else {
          clearTimeout(timeout);
          resolve();
        }
      });

      this.process = null;
      log('Python sidecar stopped');
    } catch (error) {
      log(`Error stopping Python sidecar: ${error}`);
      this.process = null;
    } finally {
      this.isShuttingDown = false;
    }
  }

  /**
   * Restart the Python sidecar server
   */
  async restartSidecar(): Promise<boolean> {
    log('Restarting Python sidecar...');
    await this.stopSidecar();
    await this.sleep(1000); // Wait 1s before restart
    return await this.startSidecar();
  }

  /**
   * Check if sidecar is running
   */
  async isRunning(): Promise<boolean> {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Get sidecar status
   */
  async getStatus(): Promise<SidecarStatus> {
    const running = await this.isRunning();
    const healthy = running ? await this.client.checkHealth() : false;

    return {
      running,
      pid: this.process?.pid || null,
      port: this.port,
      healthy
    };
  }

  /**
   * Get the client for making requests
   */
  getClient(): PythonSidecarClient {
    return this.client;
  }

  /**
   * Wait for sidecar to be ready (health check loop)
   */
  private async waitForReady(): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 200; // Check every 200ms (reduced from 500ms for faster detection)
    let attemptCount = 0;

    log(`⏱️  [TIMING] Health check loop starting (max ${this.maxStartupTime}ms)`);

    while (Date.now() - startTime < this.maxStartupTime) {
      // Check if process is still alive
      if (!this.process || this.process.killed) {
        log('Sidecar process died during startup');
        return false;
      }

      // Try health check
      attemptCount++;
      const checkStart = Date.now();
      const elapsed = Date.now() - startTime;

      try {
        log(`⏱️  [TIMING] Health check attempt #${attemptCount} at ${elapsed}ms`);

        // Get detailed health status
        const healthStatus = await this.client.getHealthStatus();
        const checkDuration = Date.now() - checkStart;

        if (healthStatus) {
          log(`⏱️  [TIMING] Health check #${attemptCount} response (${checkDuration}ms): status=${healthStatus.status}, model_loaded=${healthStatus.model_loaded}, model_loading=${healthStatus.model_loading}`);

          if (healthStatus.status === 'ok') {
            const totalElapsed = Date.now() - startTime;
            log(`⏱️  [TIMING] Health check PASSED after ${totalElapsed}ms (${attemptCount} attempts)`);
            log(`⏱️  [TIMING] Model state: loaded=${healthStatus.model_loaded}, loading=${healthStatus.model_loading}`);
            return true;
          }
        } else {
          log(`⏱️  [TIMING] Health check #${attemptCount} failed (${checkDuration}ms): no response`);
        }
      } catch (error) {
        const checkDuration = Date.now() - checkStart;
        log(`⏱️  [TIMING] Health check #${attemptCount} error (${checkDuration}ms): ${error}`);
      }

      // Wait for remaining interval time (don't wait full interval if check took time)
      const checkDuration = Date.now() - checkStart;
      const remainingWait = Math.max(0, checkInterval - checkDuration);
      await this.sleep(remainingWait);
    }

    const totalElapsed = Date.now() - startTime;
    log(`⏱️  [TIMING] Sidecar startup TIMEOUT after ${totalElapsed}ms (${attemptCount} attempts)`);
    return false;
  }

  /**
   * Get project root directory based on runtime context
   *
   * Handles different scenarios:
   * - Running from source (src/main/worker/)
   * - Running from compiled dist (dist/)
   * - Running from packaged app (app.asar.unpacked/)
   */
  private getProjectRoot(): string {
    // Detect if running from bundled asar archive
    if (__dirname.includes('app.asar')) {
      // In packaged app: __dirname is like /app.asar/dist
      // Python files are in app.asar.unpacked/ (not app.asar)
      const asarIndex = __dirname.indexOf('app.asar');
      const asarDir = __dirname.substring(0, asarIndex);
      return path.join(asarDir, 'app.asar.unpacked');
    }

    // Check if running from compiled dist/ or source src/
    if (__dirname.includes('/dist')) {
      // Running from dist/ - go up 1 level to project root
      return path.join(__dirname, '..');
    } else {
      // Running from src/main/worker/ - go up 3 levels to project root
      return path.join(__dirname, '../../..');
    }
  }

  /**
   * Get default Python path
   *
   * Always uses system python3. If dependencies are not installed,
   * the startup check will catch it and show setup instructions.
   */
  private getDefaultPythonPath(): string {
    return 'python3';
  }

  /**
   * Build environment with comprehensive PATH for Python execution
   *
   * Packaged Electron apps launched from Finder have a minimal PATH
   * that may not include Homebrew, user bin dirs, or other Python locations.
   * This ensures we find the same Python and packages as in development.
   */
  private getPythonEnv(): NodeJS.ProcessEnv {
    // Common Python installation paths (Intel Mac, Apple Silicon, system)
    const pythonPaths = [
      '/usr/local/bin',        // Homebrew on Intel Mac
      '/opt/homebrew/bin',     // Homebrew on Apple Silicon
      '/opt/local/bin',        // MacPorts
      '/Library/Frameworks/Python.framework/Versions/Current/bin', // Python.org installer
      process.env.HOME + '/Library/Python/*/bin',  // User pip packages
      process.env.HOME + '/.local/bin',            // User local packages
    ];

    // Prepend Python paths to existing PATH
    const enhancedPath = [...pythonPaths, process.env.PATH || ''].join(':');

    return {
      ...process.env,
      PATH: enhancedPath,
      PYTHONUNBUFFERED: '1'  // Force unbuffered output
    };
  }

  /**
   * Get default script path based on environment
   */
  private getDefaultScriptPath(): string {
    const projectRoot = this.getProjectRoot();
    return path.join(projectRoot, 'embedding_sidecar/embed_server.py');
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
