import path from 'node:path';
import { IEmbedder, EmbedderConfig } from './IEmbedder';
import { ChildProcessManager } from '../utils/ChildProcessManager';
import { ProcessMemoryMonitor } from '../utils/ProcessMemoryMonitor';
import { ModelPathResolver } from './ModelPathResolver';
import { IPCMessageBuilder, MessageTypeGuards } from './IPCMessageProtocol';
import { ProcessStateMachine, EmbedderState } from '../utils/ProcessStateMachine';
import { createEmbedderEventEmitter, EmbedderEventHelpers } from './EmbedderEventEmitter';
import { RetryExecutor, RetryStrategyFactory } from '../utils/RetryStrategy';
import { logger } from '../utils/logger';

export class IsolatedEmbedder implements IEmbedder {
  private processManager: ChildProcessManager | null = null;
  private memoryMonitor: ProcessMemoryMonitor;
  private pathResolver: ModelPathResolver;
  private stateMachine: ProcessStateMachine;
  private events: ReturnType<typeof createEmbedderEventEmitter>;
  private retryExecutor: RetryExecutor;
  private inflight = new Map<string, { resolve: Function, reject: Function, startTime: number }>();
  public filesSinceSpawn = 0; // Made public for shouldRestart check
  private initPromise: Promise<void> | null = null;
  private readonly config: Required<EmbedderConfig>;
  private readonly embedderId: string;
  private spawnTime = 0;
  private restartCount = 0;

  constructor(private modelName = 'Xenova/multilingual-e5-small', config?: EmbedderConfig) {
    this.config = {
      modelName: config?.modelName || this.modelName,
      maxFilesBeforeRestart: config?.maxFilesBeforeRestart || 500,
      maxMemoryMB: config?.maxMemoryMB || 1500,
      batchSize: config?.batchSize || 32
    };

    // Update modelName if provided in config
    if (this.config.modelName) {
      this.modelName = this.config.modelName;
    }

    // Generate unique embedder ID
    this.embedderId = `embedder_${Math.random().toString(36).slice(2)}`;

    // Initialize utilities
    this.memoryMonitor = ProcessMemoryMonitor.forEmbedder(this.config.maxMemoryMB);
    this.pathResolver = new ModelPathResolver(this.modelName);
    this.stateMachine = new ProcessStateMachine({ enableLogging: process.env.NODE_ENV !== 'production' });
    this.events = createEmbedderEventEmitter(this.embedderId);
    this.retryExecutor = new RetryExecutor(RetryStrategyFactory.forEmbedder());

    // Set up state machine event handlers
    this.setupStateMachineEvents();

    // Emit initialization event
    this.events.emit('embedder:initialized');
  }

  /**
   * Set up state machine event handlers for monitoring and debugging
   */
  private setupStateMachineEvents(): void {
    this.stateMachine.on('stateChange', (from, to, context) => {
      logger.log('ISOLATED', `State: ${from} → ${to}${context.reason ? ` (${context.reason})` : ''}`);

      // Handle automatic restart on error if no operations are pending
      if (to === EmbedderState.Error && this.inflight.size === 0) {
        // Schedule restart after a brief delay
        setTimeout(async () => {
          if (this.stateMachine.isErrorState() && !this.stateMachine.isShuttingDown()) {
            try {
              await this.restart();
            } catch (error) {
              logger.error('ISOLATED', 'Auto-restart failed:', error);
            }
          }
        }, 1000);
      }
    });

    this.stateMachine.on('invalidTransition', (from, to, reason) => {
      logger.warn('ISOLATED', `Invalid state transition: ${from} → ${to} (${reason})`);
    });
  }

  
  public async initialize(): Promise<boolean> {
    // Transition to spawning state if uninitialized
    if (this.stateMachine.isState(EmbedderState.Uninitialized)) {
      this.stateMachine.transition(EmbedderState.Spawning, {
        reason: 'Initialize called'
      });
    }

    // Just spawn the child process, don't wait for it to be ready
    // The actual embed operations will handle readiness checks
    await this.spawnChild();
    return true;
  }

  private async spawnChild(): Promise<void> {
    logger.log('ISOLATED', 'Starting embedder spawn with ChildProcessManager...');

    // Clean up existing process manager
    if (this.processManager) {
      await this.processManager.shutdown();
      this.processManager = null;
    }

    // State should already be set to Spawning by caller
    // Don't transition here to avoid spawning → spawning invalid transition

    this.filesSinceSpawn = 0;
    this.inflight.clear();

    // Get child script path using environment logic
    const childPath = process.env.NODE_ENV === 'production' && process.resourcesPath
      ? path.join(process.resourcesPath, 'app.asar', 'dist', 'embedder.child.cjs')
      : path.join(process.cwd(), 'dist', 'embedder.child.cjs');

    // Get environment variables from path resolver
    const envVars = this.pathResolver.getTransformersEnv();

    // Create and configure the process manager
    this.processManager = new ChildProcessManager({
      scriptPath: childPath,
      env: {
        ...envVars,
        // Force pure Node.js mode
        ELECTRON_RUN_AS_NODE: '1',
        // Disable ONNX optimizations that might cause issues
        ORT_DISABLE_ALL_OPTIONAL_OPTIMIZERS: '1'
      },
      timeout: 60000,
      onStdout: (data) => {
        const lines = data.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            logger.log('CHILD-OUT', `[EMBEDDER] ${line}`);
          }
        }
      },
      onStderr: (data) => {
        logger.error('CHILD-ERR', `[EMBEDDER] ${data}`);
      }
    });

    // Set up event handlers
    this.processManager.on('ready', () => {
      this.stateMachine.transition(EmbedderState.Ready, {
        reason: 'Process manager signaled ready'
      });

      // Check and emit model load event
      const modelInfo = this.pathResolver.getModelInfo();
      if (modelInfo.exists && modelInfo.size) {
        this.events.emit('resource:model_loaded', modelInfo.path, modelInfo.size);
      }
    });

    this.processManager.on('error', (err) => {
      logger.error('ISOLATED', 'Embedder child error:', err);
      this.stateMachine.transition(EmbedderState.Error, {
        reason: 'Process manager error',
        error: err
      });

      // Reject all pending operations
      for (const handler of this.inflight.values()) {
        handler.reject(err);
      }
      this.inflight.clear();
    });

    this.processManager.on('exit', (code, signal) => {
      logger.error('ISOLATED', `Embedder child exited with code ${code}, signal ${signal}`);
      this.events.emit('debug:process_exit', code, signal);

      if (!this.stateMachine.isShuttingDown()) {
        this.stateMachine.transition(EmbedderState.Error, {
          reason: `Process exited with code ${code}, signal ${signal}`,
          metadata: { code, signal }
        });
      }

      // Reject all pending operations
      for (const handler of this.inflight.values()) {
        handler.reject(new Error('Embedder process exited'));
      }
      this.inflight.clear();
    });

    this.processManager.on('message', (msg: any) => {
      if (MessageTypeGuards.isEmbedSuccessMessage(msg) || MessageTypeGuards.isEmbedErrorMessage(msg)) {
        this.events.emit('ipc:message_received', msg.type, msg.id);
        const handler = this.inflight.get(msg.id);
        if (handler) {
          this.inflight.delete(msg.id);
          if (MessageTypeGuards.isEmbedSuccessMessage(msg)) {
            handler.resolve(msg.vectors);
          } else {
            handler.reject(new Error(msg.error));
          }
        }
      } else if (MessageTypeGuards.isInitErrorMessage(msg)) {
        logger.error('ISOLATED', 'Embedder init failed:', msg.error);
        this.stateMachine.transition(EmbedderState.Error, {
          reason: 'Embedder initialization failed',
          error: new Error(msg.error)
        });
      }
    });

    // Start the process without waiting
    this.processManager.start().catch((error) => {
      logger.error('ISOLATED', 'Failed to start child process:', error);
    });

    // Listen for IPC ready signal from child process
    this.processManager.on('ipc-ready', () => {
      const initMessage = IPCMessageBuilder.init(this.modelName);
      if (this.processManager) {
        this.processManager.send(initMessage);
      } else {
        logger.error('ISOLATED', 'Process manager not available when trying to send init message');
      }
    });

  }

  private async ensureReady(): Promise<void> {
    if (!this.stateMachine.isReady() || !this.processManager) {
      if (!this.initPromise) {
        this.initPromise = this.spawnChild()
          .then(() => {
            // Wait for the embedder to actually be ready (not just spawned)
            return this.waitForReady();
          })
          .catch((err) => {
            logger.error('ISOLATED', 'Failed to spawn child:', err);
            // Reset state on failure
            this.stateMachine.transition(EmbedderState.Error, {
              reason: 'Failed to spawn child process',
              error: err
            });
            this.processManager = null;
            throw err;
          })
          .finally(() => {
            this.initPromise = null;
          });
      }
      await this.initPromise;
    }
  }

  private async waitForReady(): Promise<void> {
    if (this.stateMachine.isReady()) {
      return; // Already ready
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stateMachine.off('stateChange', onStateChange);
        // For now, don't reject - just log the warning and continue
        // This is a temporary workaround until we fix the child process ready signaling
        logger.warn('ISOLATED', 'Proceeding despite ready timeout - embedder may still work');
        resolve();
      }, 10000); // 10 second timeout (reduced)

      const onStateChange = (from: any, to: any) => {
        if (to === 'ready') {
          clearTimeout(timeout);
          this.stateMachine.off('stateChange', onStateChange);
            resolve();
        } else if (to === 'error') {
          clearTimeout(timeout);
          this.stateMachine.off('stateChange', onStateChange);
          reject(new Error('Embedder transitioned to error state'));
        }
      };

      this.stateMachine.on('stateChange', onStateChange);
    });
  }

  async embed(texts: string[], isQuery = false): Promise<number[][]> {
    // Check if we can accept operations
    if (!this.stateMachine.canAcceptOperations()) {
      throw new Error(`Cannot embed: embedder is in state ${this.stateMachine.getState()}`);
    }

    await this.ensureReady();

    // Double-check process manager is available
    if (!this.processManager || !this.processManager.isConnected()) {
      this.stateMachine.transition(EmbedderState.Error, {
        reason: 'Process manager not connected'
      });
      throw new Error('Embedder child process is not connected');
    }

    // Check memory periodically to prevent crashes
    if (this.filesSinceSpawn > 50 && this.filesSinceSpawn % 10 === 0) {  // Check every 10 files after 50
      const status = this.processManager.getStatus();
      if (status.pid) {
        const checkResult = await this.memoryMonitor.checkMemoryAndRestart(status.pid);

        // Emit memory usage event
        const memInfo = await this.memoryMonitor.getMemoryUsage(status.pid);
        if (memInfo) {
          const memoryInfo = EmbedderEventHelpers.createMemoryInfo(
            memInfo.rss,
            (memInfo as any).heapUsed || 0,
            (memInfo as any).external || 0,
            this.config.maxMemoryMB
          );
          this.events.emit('memory:usage', memoryInfo);

          // Emit warning if memory usage is high
          if (memoryInfo.percentage > 80) {
            this.events.emit('memory:warning', memoryInfo, 80);
          }
        }

        if (checkResult.shouldRestart) {
          logger.log('ISOLATED', 'Memory limit reached, restarting embedder:', checkResult.reason);
          await this.restart();
          await this.ensureReady();
        }
      }
    }

    return new Promise((resolve, reject) => {
      // Create typed embed message
      const embedMessage = IPCMessageBuilder.embed(texts, isQuery);

      const timeout = setTimeout(() => {
        this.inflight.delete(embedMessage.id);
        reject(new Error('Embed timeout'));
      }, 60000);

      const startTime = Date.now();
      this.events.emit('operation:started', embedMessage.id, 'embed');
      this.events.emit('ipc:message_sent', 'embed', embedMessage.id);

      this.inflight.set(embedMessage.id, {
        resolve: (vectors: number[][]) => {
          clearTimeout(timeout);
          const duration = Date.now() - startTime;
          this.filesSinceSpawn++;

          // Emit performance metrics
          const metrics = EmbedderEventHelpers.createPerformanceMetrics(
            embedMessage.id,
            texts.length,
            duration,
            vectors.length
          );
          this.events.emit('performance:metrics', metrics);
          this.events.emit('operation:completed', embedMessage.id, duration);

          // Check for slow operations
          if (duration > 5000) {
            this.events.emit('performance:slow_operation', 'embed', duration);
          }

          resolve(vectors);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          this.events.emit('operation:failed', embedMessage.id, err);
          reject(err);
        },
        startTime
      });

      try {
        if (!this.processManager) {
          throw new Error('Process manager is not available');
        }

        this.processManager.send(embedMessage);
      } catch (err: any) {
        this.inflight.delete(embedMessage.id);
        clearTimeout(timeout);

        // If process died, transition to error state
        if (err.message?.includes('not connected') || err.message?.includes('disconnected')) {
          this.stateMachine.transition(EmbedderState.Error, {
            reason: 'Process disconnected during embed operation',
            error: err
          });
          this.processManager = null;
        }
        reject(new Error(`Failed to send message to embedder: ${err.message || err}`));
      }
    });
  }


  /**
   * Embed text with retry logic using configurable retry strategy
   */
  async embedWithRetry(texts: string[], maxRetries?: number): Promise<number[][]> {
    // For backward compatibility, if maxRetries is provided, treat second param as isQuery boolean
    const isQuery = typeof maxRetries === 'boolean' ? maxRetries : false;
    const operationId = `embed_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return this.retryExecutor.execute(async () => {
      // Check if process needs restart before attempting embed
      if (!this.processManager || !this.processManager.isConnected() || this.stateMachine.isErrorState()) {
        await this.restart();
        await this.ensureReady();
      }

      return this.embed(texts, isQuery);
    }, operationId);
  }

  /**
   * Check if the embedder should restart based on memory usage
   */
  async shouldRestart(): Promise<boolean> {
    const status = this.processManager?.getStatus();
    if (!status?.pid) {
      return false;
    }

    // Check memory using the monitor
    const checkResult = await this.memoryMonitor.checkMemoryAndRestart(status.pid);

    // Also check file count threshold
    const fileThresholdExceeded = this.filesSinceSpawn > this.config.maxFilesBeforeRestart;

    return checkResult.shouldRestart || fileThresholdExceeded;
  }

  /**
   * Restart the embedder
   */
  async restart(): Promise<void> {
    const previousUptime = this.spawnTime ? Date.now() - this.spawnTime : 0;
    this.restartCount++;

    this.stateMachine.transition(EmbedderState.Restarting, {
      reason: 'Manual restart requested'
    });

    // Emit restart event
    const restartInfo = EmbedderEventHelpers.createRestartInfo(
      'Manual restart requested',
      'manual',
      previousUptime,
      this.filesSinceSpawn,
      this.restartCount
    );
    this.events.emit('embedder:restarted', restartInfo);

    if (this.processManager) {
      await this.processManager.restart();
      // After restart, we're in spawning state waiting for ready
      this.stateMachine.transition(EmbedderState.Spawning, {
        reason: 'Process restarted, waiting for ready signal'
      });
    } else {
      await this.spawnChild();
    }
  }

  /**
   * Get embedder statistics
   */
  getStats() {
    const memoryUsage = process.memoryUsage();
    const stateMachineStats = this.stateMachine.getStatistics();

    return {
      filesSinceSpawn: this.filesSinceSpawn,
      isReady: this.stateMachine.isReady(),
      state: this.stateMachine.getState(),
      timeInCurrentState: this.stateMachine.getTimeInCurrentState(),
      memoryUsage: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round((memoryUsage as any).heapUsed / 1024 / 1024),
        external: Math.round((memoryUsage as any).external / 1024 / 1024)
      },
      stateHistory: stateMachineStats
    };
  }


  async checkMemoryAndRestart(): Promise<boolean> {
    const shouldRestart = await this.shouldRestart();
    if (shouldRestart && this.inflight.size === 0) {
      await this.restart();
      return true;
    }
    return false;
  }

  async shutdown(): Promise<void> {
    this.stateMachine.transition(EmbedderState.ShuttingDown, {
      reason: 'Shutdown requested'
    });

    if (this.processManager) {
      try {
        // Send shutdown message
        const shutdownMessage = IPCMessageBuilder.shutdown();
        this.processManager.send(shutdownMessage);
      } catch (_e) {
        // Process may already be dead or disconnected
      }

      await this.processManager.shutdown();
      this.processManager = null;
    }

    this.inflight.clear();

    this.stateMachine.transition(EmbedderState.Shutdown, {
      reason: 'Shutdown completed'
    });
  }
}

// Legacy singleton functions - DEPRECATED: Use EmbedderFactory instead
// These are kept for backward compatibility but should be replaced

import { defaultEmbedderFactory } from './EmbedderFactory';

// Global instance for backward compatibility
let legacyEmbedder: IsolatedEmbedder | null = null;
let legacyInitializing = false;
let legacyInitPromise: Promise<void> | null = null;

/**
 * @deprecated Use EmbedderFactory.createIsolatedEmbedder() instead
 */
export async function embed(texts: string[], isQuery = false): Promise<number[][]> {
  logger.warn('DEPRECATED', 'embed() function is deprecated. Use EmbedderFactory.createIsolatedEmbedder() instead.');

  // Use factory to create embedder if needed
  if (!legacyEmbedder && !legacyInitializing) {
    legacyInitializing = true;

    try {
      legacyEmbedder = defaultEmbedderFactory.createIsolatedEmbedder();
      legacyInitPromise = legacyEmbedder.initialize().then(() => {
        legacyInitializing = false;
        legacyInitPromise = null;
      });
    } catch (err) {
      legacyInitializing = false;
      legacyInitPromise = null;
      legacyEmbedder = null;
      throw err;
    }
  }

  // Wait for initialization if in progress
  if (legacyInitPromise) {
    await legacyInitPromise;
  }

  // If still no embedder after waiting, create one
  if (!legacyEmbedder) {
    legacyEmbedder = defaultEmbedderFactory.createIsolatedEmbedder();
    await legacyEmbedder.initialize();
  }

  return legacyEmbedder.embed(texts, isQuery);
}

/**
 * @deprecated Use embedder.checkMemoryAndRestart() directly instead
 */
export async function checkEmbedderMemory(): Promise<boolean> {
  logger.warn('DEPRECATED', 'checkEmbedderMemory() function is deprecated. Use embedder.checkMemoryAndRestart() directly instead.');

  if (legacyEmbedder) {
    return legacyEmbedder.checkMemoryAndRestart();
  }
  return false;
}

/**
 * @deprecated Use embedder.shutdown() directly instead
 */
export async function shutdownEmbedder(): Promise<void> {
  logger.warn('DEPRECATED', 'shutdownEmbedder() function is deprecated. Use embedder.shutdown() directly instead.');

  if (legacyEmbedder) {
    await legacyEmbedder.shutdown();
    legacyEmbedder = null;
  }
}