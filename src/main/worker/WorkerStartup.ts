/**
 * WorkerStartup - State machine for worker initialization
 *
 * Owns the full startup sequence:
 * 1. Check Ollama installation
 * 2. Start Ollama server if needed
 * 3. Check/download model
 * 4. Initialize embedder
 * 5. Start file watching
 *
 * Emits stage events via parentPort for main to relay to renderer.
 */

import { parentPort } from 'worker_threads';
import { OllamaService } from './OllamaService';
import { OllamaClient } from './OllamaClient';
import { OllamaEmbedder } from '../../shared/embeddings/implementations/OllamaEmbedder';
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
  private ollamaService: OllamaService;
  private ollamaClient: OllamaClient;
  private embedder: OllamaEmbedder | null = null;
  private abortController: AbortController | null = null;
  private ringBuffer: RingBufferEntry[] = [];
  private readonly RING_BUFFER_SIZE = 100;
  private readonly MODEL_NAME = 'nomic-embed-text';

  constructor() {
    this.ollamaClient = new OllamaClient();
    this.ollamaService = new OllamaService({
      client: this.ollamaClient,
      autoStart: true,
      defaultModel: this.MODEL_NAME,
    });
  }

  /**
   * Main initialization sequence
   */
  async initialize(settings?: any): Promise<OllamaEmbedder | null> {
    try {
      this.logToBuffer('WORKER-STARTUP', 'Starting initialization sequence');

      // Stage 1: Check Ollama installation and health
      this.emitStage('checking', 'Checking Ollama installation...');
      const installed = await this.ollamaService.checkInstallation();
      if (!installed) {
        this.emitError('OLLAMA_NOT_FOUND', 'Ollama is not installed. Please install from https://ollama.ai');
        return null;
      }

      // Stage 2: Ensure Ollama is running
      this.emitStage('checking', 'Starting Ollama server...');
      const ollamaStatus = await this.ollamaService.ensureReady();
      if (!ollamaStatus.running) {
        this.emitError('OLLAMA_START_FAILED', 'Failed to start Ollama server');
        return null;
      }

      log('Ollama is ready, version:', ollamaStatus.version);

      // Stage 3: Check/download model
      const hasModel = await this.ollamaClient.hasModel(this.MODEL_NAME);
      if (!hasModel) {
        this.emitStage('downloading', `Downloading ${this.MODEL_NAME} model...`, 0);

        const downloaded = await this.ollamaService.ensureModelDownloaded(
          this.MODEL_NAME,
          (progress) => {
            // Emit progress for UI
            this.emitDownloadProgress({
              file: progress.file,
              progress: progress.progress,
              loaded: progress.loaded,
              total: progress.total,
            });
          }
        );

        if (!downloaded) {
          this.emitError('MODEL_DOWNLOAD_FAILED', `Failed to download ${this.MODEL_NAME} model`);
          return null;
        }
      } else {
        log(`Model ${this.MODEL_NAME} already available`);
      }

      // Stage 4: Initialize embedder
      this.emitStage('initializing', 'Initializing embedder...');
      this.embedder = new OllamaEmbedder({
        modelName: this.MODEL_NAME,
        batchSize: settings?.embeddingBatchSize ?? 32,
        client: this.ollamaClient,
        keepAlive: '2m',
        normalizeVectors: true,
      });

      const initialized = await this.embedder.initialize();
      if (!initialized) {
        this.emitError('EMBEDDER_INIT_FAILED', 'Failed to initialize embedder');
        return null;
      }

      log('Embedder initialized successfully');

      // Stage 5: Ready
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
  getEmbedder(): OllamaEmbedder | null {
    return this.embedder;
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

    const stageMessage = createStageMessage(stage, message, progress);
    parentPort.postMessage(stageMessage);
    this.logToBuffer('STARTUP-STAGE', `${stage}: ${message}`);
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
}
