/**
 * OllamaService - Lifecycle management for Ollama server
 *
 * Handles installation detection, server startup, and model management.
 * Replaces the old ModelService which downloaded ONNX models.
 */

import { spawn, ChildProcess } from 'child_process';
import { OllamaClient, DownloadProgress } from './OllamaClient';
import { logger } from '../../shared/utils/logger';

// Helper to log with category
const log = (message: string, ...args: any[]) => logger.log('OLLAMA-SERVICE', message, ...args);

export interface OllamaServiceConfig {
  client?: OllamaClient;
  autoStart?: boolean;
  defaultModel?: string;
}

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  hasModel: boolean;
}

/**
 * Service for managing Ollama server lifecycle and models
 */
export class OllamaService {
  private client: OllamaClient;
  private autoStart: boolean;
  private defaultModel: string;
  private serverProcess: ChildProcess | null = null;

  constructor(config: OllamaServiceConfig = {}) {
    this.client = config.client || new OllamaClient();
    this.autoStart = config.autoStart !== false; // Default true
    this.defaultModel = config.defaultModel || 'bge-m3';
  }

  /**
   * Check if Ollama is installed on the system
   */
  async checkInstallation(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('which', ['ollama']);
      let output = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        resolve(code === 0 && output.trim().length > 0);
      });

      child.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Check if Ollama server is running
   */
  async isRunning(): Promise<boolean> {
    return this.client.checkHealth();
  }

  /**
   * Get Ollama version if installed
   */
  async getVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      const child = spawn('ollama', ['--version']);
      let output = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0 && output.trim()) {
          // Parse version from output like "ollama version 0.1.0"
          const match = output.match(/(\d+\.\d+\.\d+)/);
          resolve(match ? match[1] : output.trim());
        } else {
          resolve(null);
        }
      });

      child.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * Start Ollama server (auto-starts on macOS)
   */
  async startServer(): Promise<boolean> {
    try {
      // Check if already running
      if (await this.isRunning()) {
        log('Ollama server already running');
        return true;
      }

      log('Starting Ollama server...');

      // On macOS, `ollama serve` automatically daemonizes
      this.serverProcess = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
      });

      // Unref so it doesn't keep Node.js running
      this.serverProcess.unref();

      // Wait for server to be ready (max 10 seconds)
      for (let i = 0; i < 20; i++) {
        await this.sleep(500);
        if (await this.isRunning()) {
          log('Ollama server started successfully');
          return true;
        }
      }

      log('Ollama server failed to start within timeout');
      return false;
    } catch (error) {
      log('Error starting Ollama server:', error);
      return false;
    }
  }

  /**
   * Ensure Ollama is ready (installed, running, model downloaded)
   */
  async ensureReady(): Promise<OllamaStatus> {
    const status: OllamaStatus = {
      installed: false,
      running: false,
      version: null,
      hasModel: false,
    };

    // Check installation
    status.installed = await this.checkInstallation();
    if (!status.installed) {
      log('Ollama is not installed');
      return status;
    }

    // Get version
    status.version = await this.getVersion();
    log(`Ollama version: ${status.version || 'unknown'}`);

    // Check if running
    status.running = await this.isRunning();

    // Auto-start if enabled and not running
    if (!status.running && this.autoStart) {
      status.running = await this.startServer();
    }

    if (!status.running) {
      log('Ollama server is not running');
      return status;
    }

    // Check if model exists
    status.hasModel = await this.client.hasModel(this.defaultModel);
    log(`Model ${this.defaultModel} available: ${status.hasModel}`);

    return status;
  }

  /**
   * Download the default model if not already available
   */
  async ensureModelDownloaded(
    modelName?: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<boolean> {
    const model = modelName || this.defaultModel;

    try {
      // Check if model already exists
      const hasModel = await this.client.hasModel(model);
      if (hasModel) {
        log(`Model ${model} already available`);
        return true;
      }

      log(`Downloading model ${model}...`);
      await this.client.pullModel(model, (progress) => {
        log(`Pull progress: ${progress.status}`, progress);
        onProgress?.(progress);
      });

      log(`Model ${model} downloaded successfully`);
      return true;
    } catch (error) {
      log(`Failed to download model ${model}:`, error);
      return false;
    }
  }

  /**
   * Get comprehensive status of Ollama setup
   */
  async getStatus(): Promise<OllamaStatus> {
    const status: OllamaStatus = {
      installed: false,
      running: false,
      version: null,
      hasModel: false,
    };

    status.installed = await this.checkInstallation();
    if (status.installed) {
      status.version = await this.getVersion();
      status.running = await this.isRunning();
      if (status.running) {
        status.hasModel = await this.client.hasModel(this.defaultModel);
      }
    }

    return status;
  }

  /**
   * Get the Ollama client instance
   */
  getClient(): OllamaClient {
    return this.client;
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    // We don't stop the Ollama server as it may be used by other applications
    // Just cleanup our references
    if (this.serverProcess) {
      this.serverProcess = null;
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
