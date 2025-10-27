/**
 * PythonSidecarService - Lifecycle management for Python embedding sidecar
 *
 * Handles automatic startup, health monitoring, and shutdown of the Python
 * FastAPI embedding server. The sidecar runs as a child process and provides
 * embedding generation via HTTP API.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { PythonSidecarClient } from './PythonSidecarClient';
import { logger } from '../../shared/utils/logger';

// Helper to log with category
const log = (message: string, ...args: any[]) => logger.log('SIDECAR-SERVICE', message, ...args);

export interface PythonSidecarServiceConfig {
  client?: PythonSidecarClient;
  pythonPath?: string;      // Path to Python interpreter
  scriptPath?: string;      // Path to embed_server.py
  port?: number;            // Port to run sidecar on
  autoRestart?: boolean;    // Auto-restart on crash
  maxStartupTime?: number;  // Max time to wait for startup (ms)
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

  constructor(config: PythonSidecarServiceConfig = {}) {
    this.client = config.client || new PythonSidecarClient({ port: config.port });
    this.port = config.port || 8421;
    this.autoRestart = config.autoRestart !== false; // Default true
    this.maxStartupTime = config.maxStartupTime || 30000; // 30s

    // Determine Python path (development vs production)
    this.pythonPath = config.pythonPath || this.getDefaultPythonPath();

    // Determine script path (development vs production)
    this.scriptPath = config.scriptPath || this.getDefaultScriptPath();
  }

  /**
   * Start the Python sidecar server
   */
  async startSidecar(): Promise<boolean> {
    if (this.process) {
      log('Sidecar already running');
      return true;
    }

    log(`Starting Python sidecar on port ${this.port}...`);
    log(`Python path: ${this.pythonPath}`);
    log(`Script path: ${this.scriptPath}`);

    try {
      // Spawn Python process
      this.process = spawn(this.pythonPath, [
        this.scriptPath,
        '--port', this.port.toString()
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1' // Force unbuffered output
        }
      });

      // Handle stdout
      this.process.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          logger.log('SIDECAR-STDOUT', output);
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
          log('Auto-restarting sidecar in 2s...');
          setTimeout(() => this.startSidecar(), 2000);
        }
      });

      // Handle process error
      this.process.on('error', (error) => {
        log(`Sidecar process error: ${error}`);
        this.process = null;
      });

      log(`Sidecar process spawned (PID: ${this.process.pid})`);

      // Wait for sidecar to be ready (health check loop)
      const isReady = await this.waitForReady();

      if (isReady) {
        log('✅ Python sidecar started successfully');
        return true;
      } else {
        log('❌ Python sidecar failed to start (health check timeout)');
        await this.stopSidecar();
        return false;
      }
    } catch (error) {
      log(`Failed to start Python sidecar: ${error}`);
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

      // Wait up to 5s for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process) {
            log('Graceful shutdown timeout, forcing kill...');
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

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
    const checkInterval = 500; // Check every 500ms

    while (Date.now() - startTime < this.maxStartupTime) {
      // Check if process is still alive
      if (!this.process || this.process.killed) {
        log('Sidecar process died during startup');
        return false;
      }

      // Try health check
      try {
        const isHealthy = await this.client.checkHealth();
        if (isHealthy) {
          const elapsed = Date.now() - startTime;
          log(`Sidecar ready after ${elapsed}ms`);
          return true;
        }
      } catch (error) {
        // Health check failed, keep waiting
      }

      // Wait before next check
      await this.sleep(checkInterval);
    }

    log(`Sidecar startup timeout after ${this.maxStartupTime}ms`);
    return false;
  }

  /**
   * Get default Python path based on environment
   */
  private getDefaultPythonPath(): string {
    // In development, use system Python or venv
    if (process.env.NODE_ENV !== 'production') {
      // Try venv first
      const venvPath = path.join(__dirname, '../../../embedding_sidecar/.venv/bin/python');
      // For now, return python3 (we'll use venv when available)
      return 'python3';
    }

    // In production, use bundled Python
    // TODO: Implement bundled Python path resolution
    return 'python3';
  }

  /**
   * Get default script path based on environment
   */
  private getDefaultScriptPath(): string {
    // In development, use local script
    if (process.env.NODE_ENV !== 'production') {
      return path.join(__dirname, '../../../embedding_sidecar/embed_server.py');
    }

    // In production, use bundled script
    // TODO: Implement bundled script path resolution
    return path.join(__dirname, '../../../embedding_sidecar/embed_server.py');
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
