/**
 * WorkerStartup - State machine for worker initialization
 *
 * Owns the full startup sequence:
 * 1. Start Python sidecar server (checks dependencies, then starts sidecar)
 * 2. Wait for sidecar to be ready (model loading)
 * 3. Initialize embedder
 * 4. Ready
 *
 * Emits stage events via parentPort for main to relay to renderer.
 */

import { parentPort } from 'worker_threads';
import { PythonSidecarService, type DownloadProgressEvent } from './PythonSidecarService';
import { PythonSidecarClient } from './PythonSidecarClient';
import { PythonSidecarEmbedder } from './embeddings/PythonSidecarEmbedder';
import { logger } from '../../shared/utils/logger';
import {
  type StartupStage,
  type StartupErrorCode,
  createStageMessage,
  createErrorMessage,
  createDownloadProgressMessage,
} from '../../shared/types/startup';

// Helper to log with category
const log = (message: string, ...args: any[]) => logger.log('WORKER-STARTUP', message, ...args);

interface RingBufferEntry {
  timestamp: number;
  category: string;
  message: string;
}

export class WorkerStartup {
  private sidecarService: PythonSidecarService;
  private sidecarClient: PythonSidecarClient;
  private embedder: PythonSidecarEmbedder | null = null;
  private abortController: AbortController | null = null;
  private ringBuffer: RingBufferEntry[] = [];
  private readonly RING_BUFFER_SIZE = 100;
  private readonly MODEL_NAME = 'paraphrase-multilingual-mpnet-base-v2';
  private currentStage: StartupStage | null = null;

  constructor() {
    this.sidecarClient = new PythonSidecarClient();
    this.sidecarService = new PythonSidecarService({
      client: this.sidecarClient,
      autoRestart: true,
      onProgress: (event) => this.handleProgressEvent(event),
    });
  }

  /**
   * Main initialization sequence
   */
  async initialize(settings?: any): Promise<PythonSidecarEmbedder | null> {
    try {
      this.logToBuffer('WORKER-STARTUP', 'Starting initialization sequence');

      // Stage 1: Start Python sidecar (includes dependency check)
      this.emitStage('sidecar_start', 'Starting Python sidecar server...');

      // Check Python dependencies
      this.emitProgress('Checking Python dependencies...');
      const depsCheck = await this.sidecarService.checkDependencies();

      if (depsCheck && !depsCheck.all_present) {
        // Dependencies are missing - provide error with README link
        const missingPackages = depsCheck.missing?.join(', ') || 'unknown';

        this.emitError(
          'PYTHON_DEPS_MISSING',
          'Required Python dependencies are not installed',
          {
            missing: depsCheck.missing,
            python_version: depsCheck.python_version,
            help: 'Please install Python dependencies. See installation instructions in the README.',
            helpUrl: 'https://github.com/jean-bovet/Semantica/blob/main/README.md'
          }
        );
        log(`Missing Python dependencies: ${missingPackages}`);
        return null;
      }

      // Dependencies OK, start the sidecar
      this.emitProgress('Starting sidecar process...');
      const started = await this.sidecarService.startSidecar();
      if (!started) {
        this.emitError('SIDECAR_START_FAILED', 'Failed to start Python sidecar server');
        return null;
      }

      log('Python sidecar started successfully');

      // Stage 2: Wait for sidecar to be ready (model loading)
      this.emitStage('sidecar_ready', 'Loading embedding model...');
      const status = await this.sidecarService.getStatus();
      if (!status.healthy) {
        this.emitError('SIDECAR_NOT_HEALTHY', 'Python sidecar is not healthy');
        return null;
      }

      log('Python sidecar is healthy and ready');

      // Stage 3: Initialize embedder
      this.emitStage('embedder_init', 'Initializing embedder...');
      this.embedder = new PythonSidecarEmbedder({
        modelName: this.MODEL_NAME,
        batchSize: settings?.embeddingBatchSize ?? 32,
        client: this.sidecarClient,
        normalizeVectors: true,
      });

      const initialized = await this.embedder.initialize();
      if (!initialized) {
        this.emitError('EMBEDDER_INIT_FAILED', 'Failed to initialize embedder');
        return null;
      }

      log('Embedder initialized successfully');

      // Stage 4: Ready
      this.emitStage('ready', 'Worker ready');
      this.logToBuffer('WORKER-STARTUP', 'Initialization complete');

      return this.embedder;
    } catch (error) {
      log('Initialization failed:', error);
      this.emitError('EMBEDDER_INIT_FAILED', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Get the initialized embedder
   */
  getEmbedder(): PythonSidecarEmbedder | null {
    return this.embedder;
  }

  /**
   * Get the sidecar service
   */
  getSidecarService(): PythonSidecarService {
    return this.sidecarService;
  }

  /**
   * Cancel ongoing operations (e.g., model download)
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Get diagnostic logs from ring buffer
   */
  getLogs(): RingBufferEntry[] {
    return [...this.ringBuffer];
  }

  /**
   * Emit stage change event to main process
   */
  private emitStage(stage: StartupStage, message: string, progress?: number) {
    if (!parentPort) return;

    this.currentStage = stage;
    const stageMessage = createStageMessage(stage, message, progress);
    parentPort.postMessage(stageMessage);
    this.logToBuffer('STARTUP-STAGE', `${stage}: ${message}`);
  }

  /**
   * Emit progress update within the current stage
   */
  private emitProgress(message: string, progress?: number) {
    if (!parentPort || !this.currentStage) return;

    const stageMessage = createStageMessage(this.currentStage, message, progress);
    parentPort.postMessage(stageMessage);
    this.logToBuffer('STARTUP-PROGRESS', `${this.currentStage}: ${message}`);
  }

  /**
   * Emit download progress event to main process
   */
  private emitDownloadProgress(progress: {
    file: string;
    progress: number;
    loaded: number;
    total: number;
  }) {
    if (!parentPort) return;

    const progressMessage = createDownloadProgressMessage(
      progress.file,
      progress.progress,
      progress.loaded,
      progress.total
    );

    parentPort.postMessage(progressMessage);
  }

  /**
   * Emit error event to main process
   */
  private emitError(code: StartupErrorCode, message: string, details?: unknown) {
    if (!parentPort) return;

    const errorMessage = createErrorMessage(code, message, details);
    parentPort.postMessage(errorMessage);
    this.logToBuffer('STARTUP-ERROR', `${code}: ${message}`);
  }

  /**
   * Add entry to ring buffer
   */
  private logToBuffer(category: string, message: string) {
    this.ringBuffer.push({
      timestamp: Date.now(),
      category,
      message,
    });

    // Keep buffer size limited
    if (this.ringBuffer.length > this.RING_BUFFER_SIZE) {
      this.ringBuffer.shift();
    }
  }

  /**
   * Handle progress events from Python sidecar (model loading/download)
   */
  private handleProgressEvent(event: DownloadProgressEvent) {
    log(`Sidecar progress: ${event.type}`, event.data);

    switch (event.type) {
      case 'model_cached':
        // Model already downloaded, loading from cache
        log('Model found in cache, loading...');
        break;

      case 'download_started':
        // Model needs to be downloaded (first run)
        this.emitStage('downloading', `Downloading embedding model (${event.data.model})...`);
        this.logToBuffer('MODEL-DOWNLOAD', `Downloading ${event.data.model}`);
        break;

      case 'model_loaded':
        // Model loaded successfully (either from cache or after download)
        log(`Model loaded: ${event.data.model}, dimensions: ${event.data.dimensions}`);
        this.logToBuffer('MODEL-READY', `Model loaded with ${event.data.dimensions} dimensions`);
        break;
    }
  }
}
