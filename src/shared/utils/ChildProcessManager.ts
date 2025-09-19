import { spawn as nodeSpawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

/**
 * Dependencies that can be injected for testing
 */
export interface ChildProcessDependencies {
  spawn?: (command: string, args?: string[], options?: any) => ChildProcess;
}

/**
 * Configuration for child process management
 */
export interface ChildProcessConfig {
  scriptPath: string;
  nodeArgs?: string[];
  env?: Record<string, string>;
  stdio?: ('pipe' | 'inherit' | 'ignore' | 'ipc')[];
  timeout?: number;
  maxRestarts?: number;
  restartDelay?: number;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  dependencies?: ChildProcessDependencies;
}

/**
 * Events emitted by ChildProcessManager
 */
export interface ChildProcessEvents {
  ready: () => void;
  error: (error: Error) => void;
  exit: (code: number | null, signal: string | null) => void;
  message: (message: any) => void;
  restart: (attempt: number) => void;
  spawn: (pid: number) => void;
}

/**
 * Status of the child process
 */
export interface ProcessStatus {
  isRunning: boolean;
  isReady: boolean;
  isSpawning: boolean;
  pid: number | null;
  restartCount: number;
  lastError: Error | null;
  uptime: number; // in milliseconds
}

/**
 * Manages the lifecycle of a child process with automatic restart capabilities,
 * proper cleanup, and event-driven communication.
 */
export class ChildProcessManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private config: Required<Omit<ChildProcessConfig, 'dependencies'>>;
  private readonly spawn: ChildProcessDependencies['spawn'];
  private spawning = false;
  private ready = false;
  private restartCount = 0;
  private lastError: Error | null = null;
  private spawnTime = 0;
  private initPromise: Promise<void> | null = null;
  private shutdownRequested = false;

  constructor(config: ChildProcessConfig) {
    super();

    this.config = {
      nodeArgs: [],
      env: {},
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      timeout: 60000,
      maxRestarts: 5,
      restartDelay: 1000,
      onStdout: () => {},
      onStderr: () => {},
      ...config
    };

    // Set up dependencies with defaults
    this.spawn = config.dependencies?.spawn || nodeSpawn;

    // Validate required config
    if (!this.config.scriptPath) {
      throw new Error('scriptPath is required');
    }
  }

  /**
   * Start the child process
   */
  async start(): Promise<void> {
    if (this.shutdownRequested) {
      throw new Error('Cannot start: shutdown was requested');
    }

    if (!this.initPromise) {
      this.initPromise = this.spawnChild();
    }

    return this.initPromise;
  }

  /**
   * Send a message to the child process
   */
  send(message: any): boolean {
    if (!this.child || !this.isConnected()) {
      throw new Error('Child process is not available or not connected');
    }

    try {
      return this.child.send(message);
    } catch (error: any) {
      // If EPIPE error, the child died - mark as not ready
      if (error.code === 'EPIPE' || error.message?.includes('disconnected')) {
        this.ready = false;
        this.child = null;
      }
      throw new Error(`Failed to send message to child process: ${error.message}`);
    }
  }

  /**
   * Check if child process is connected
   */
  isConnected(): boolean {
    return this.child !== null && (this.child as any).connected === true;
  }

  /**
   * Get current process status
   */
  getStatus(): ProcessStatus {
    return {
      isRunning: this.child !== null && !this.child.killed,
      isReady: this.ready,
      isSpawning: this.spawning,
      pid: this.child?.pid || null,
      restartCount: this.restartCount,
      lastError: this.lastError,
      uptime: this.spawnTime ? Date.now() - this.spawnTime : 0
    };
  }

  /**
   * Restart the child process
   */
  async restart(): Promise<void> {
    await this.stop();
    this.restartCount++;
    this.emit('restart', this.restartCount);
    await this.spawnChild();
  }

  /**
   * Stop the child process gracefully
   */
  async stop(): Promise<void> {
    if (!this.child) {
      return;
    }

    try {
      // Try to send shutdown message if connected
      if (this.isConnected()) {
        this.child.send({ type: 'shutdown' });
        await new Promise(r => setTimeout(r, 200));
      }
    } catch {
      // Child may already be dead or disconnected
    }

    await this.killProcess();
  }

  /**
   * Shutdown the manager and cleanup resources
   */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    await this.stop();
    this.removeAllListeners();
  }

  /**
   * Force kill the child process
   */
  private async killProcess(): Promise<void> {
    if (!this.child) {
      return;
    }

    try {
      // Try graceful termination first
      if (!this.child.killed) {
        this.child.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 100));
      }

      // Force kill if still alive
      if (this.child && !this.child.killed) {
        this.child.kill('SIGKILL');
      }
    } catch {
      // Process might already be dead
    } finally {
      this.child = null;
      this.ready = false;
    }
  }

  /**
   * Spawn the child process with proper setup
   */
  private async spawnChild(): Promise<void> {
    if (this.spawning) {
      // Wait for existing spawn to complete
      let waitTime = 0;
      while (this.spawning && waitTime < 30000) {
        await new Promise(r => setTimeout(r, 100));
        waitTime += 100;
      }

      if (this.spawning) {
        this.spawning = false;
        await this.killProcess();
      }

      if (this.ready) {
        return;
      }
    }

    this.spawning = true;
    this.ready = false;
    this.lastError = null;

    try {
      // Clean up existing process
      if (this.child) {
        await this.killProcess();
      }

      // Determine node executable path
      const nodePath = this.getNodePath();

      // Prepare environment
      const env = {
        ...process.env,
        ...this.config.env,
        ELECTRON_RUN_AS_NODE: '1'
      };

      // Spawn the child process
      this.child = this.spawn!(nodePath, [...this.config.nodeArgs, this.config.scriptPath], {
        stdio: this.config.stdio as any,
        env
      });

      if (!this.child.pid) {
        throw new Error('Failed to get child process PID');
      }

      this.spawnTime = Date.now();
      this.emit('spawn', this.child.pid);

      this.setupChildEventHandlers();

      // Wait for ready signal with timeout
      await this.waitForReady();

    } catch (error: any) {
      this.lastError = error;
      this.ready = false;
      this.child = null;
      throw error;
    } finally {
      this.spawning = false;
      this.initPromise = null;
    }
  }

  /**
   * Setup event handlers for the child process
   */
  private setupChildEventHandlers(): void {
    if (!this.child) return;

    // Handle stdout
    this.child.stdout?.on('data', (data) => {
      const output = data.toString();
      this.config.onStdout(output);

      // Log with prefix for debugging
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(`[CHILD-OUT] ${line}`);
        }
      }
    });

    // Handle stderr
    this.child.stderr?.on('data', (data) => {
      const output = data.toString();
      this.config.onStderr(output);
      console.error(`[CHILD-ERR] ${output}`);
    });

    // Handle IPC messages
    this.child.on('message', (msg: any) => {
      if (msg?.type === 'ready') {
        this.ready = true;
        this.emit('ready');
      } else if (msg?.type === 'init:err') {
        const error = new Error(msg.error || 'Child process initialization failed');
        this.lastError = error;
        this.ready = false;
        this.emit('error', error);
      } else {
        this.emit('message', msg);
      }
    });

    // Handle process errors
    this.child.on('error', (err) => {
      this.lastError = err;
      this.ready = false;
      this.emit('error', err);
    });

    // Handle process exit
    this.child.on('exit', (code, signal) => {
      this.ready = false;
      this.emit('exit', code, signal);

      // Auto-restart if not shutdown requested and within restart limit
      if (!this.shutdownRequested && this.restartCount < this.config.maxRestarts) {
        setTimeout(() => {
          this.restart().catch(error => {
            this.emit('error', error);
          });
        }, this.config.restartDelay);
      }
    });
  }

  /**
   * Wait for the child process to signal ready
   */
  private async waitForReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.killProcess();
        reject(new Error(`Child process init timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      const checkReady = setInterval(() => {
        if (this.ready) {
          clearInterval(checkReady);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);

      // Also listen for errors during initialization
      const onError = (error: Error) => {
        clearInterval(checkReady);
        clearTimeout(timeout);
        this.off('error', onError);
        reject(error);
      };

      this.once('error', onError);
    });
  }

  /**
   * Get the appropriate Node.js executable path
   */
  private getNodePath(): string {
    // If running under Electron, use system node
    if (process.execPath.includes('Electron')) {
      return 'node';
    }
    return process.execPath;
  }
}

// TypeScript event emitter typing
export interface ChildProcessManager {
  on<K extends keyof ChildProcessEvents>(event: K, listener: ChildProcessEvents[K]): this;
  emit<K extends keyof ChildProcessEvents>(event: K, ...args: Parameters<ChildProcessEvents[K]>): boolean;
}