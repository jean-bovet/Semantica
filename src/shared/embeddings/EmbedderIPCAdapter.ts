/**
 * IPC Adapter for the embedder core.
 * Handles message routing between the IPC layer and the core business logic.
 */

import { EmbedderCore } from './EmbedderCore';
import { IProcessMessenger } from './interfaces/IProcessMessenger';
import { IPCMessageRouter, IPCMessageBuilder, MessageTypeGuards } from './IPCMessageProtocol';

/**
 * Adapter that connects the EmbedderCore to IPC messaging.
 * This separates IPC concerns from business logic for better testability.
 */
export class EmbedderIPCAdapter {
  private router: IPCMessageRouter;

  constructor(
    private core: EmbedderCore,
    private messenger: IProcessMessenger
  ) {
    this.router = new IPCMessageRouter();
    this.setupRoutes();
  }

  /**
   * Set up message routing handlers
   */
  private setupRoutes(): void {
    // Handle model check requests
    this.router.on('check-model', async () => {
      try {
        if (process.env.DEBUG_EMBEDDER) console.log('[IPCAdapter] Handling check-model request');
        const exists = await this.core.checkModel();
        const response = IPCMessageBuilder.modelStatus(exists);
        this.messenger.send(response);
      } catch (e: any) {
        console.error('[IPCAdapter] Model check failed:', e);
        const response = IPCMessageBuilder.modelStatus(false, String(e));
        this.messenger.send(response);
      }
    });

    // Handle initialization requests
    this.router.on('init', async (msg) => {
      if (!MessageTypeGuards.isInitMessage(msg)) {
        console.warn('[IPCAdapter] Invalid init message format');
        return;
      }

      try {
        const modelName = msg.model || 'Xenova/multilingual-e5-small';
        if (process.env.DEBUG_EMBEDDER) console.log(`[IPCAdapter] Initializing core with model: ${modelName}`);

        await this.core.initialize(modelName);

        // Verify the model was loaded successfully
        const modelInfo = await this.core.getModelInfo(modelName);
        if (modelInfo.exists) {
          if (process.env.DEBUG_EMBEDDER) {
            console.log('[IPCAdapter] Model loaded successfully, size:',
              modelInfo.size ? `${(modelInfo.size / 1024 / 1024).toFixed(2)} MB` : 'unknown');
          }
          const response = IPCMessageBuilder.ready();
          this.messenger.send(response);
        } else {
          throw new Error('Model file not found after initialization');
        }
      } catch (e: any) {
        console.error('[IPCAdapter] Initialization failed:', e);
        const response = IPCMessageBuilder.initError(e);
        this.messenger.send(response);
      }
    });

    // Handle embedding requests
    this.router.on('embed', async (msg) => {
      if (!MessageTypeGuards.isEmbedMessage(msg)) {
        console.warn('[IPCAdapter] Invalid embed message format');
        return;
      }

      try {
        if (process.env.DEBUG_EMBEDDER) {
          console.log(`[IPCAdapter] Processing embed request ${msg.id} for ${msg.texts.length} texts`);
        }

        const vectors = await this.core.embed(msg.texts, msg.isQuery || false);

        if (process.env.DEBUG_EMBEDDER) {
          console.log(`[IPCAdapter] Successfully embedded ${vectors.length} texts for request ${msg.id}`);
        }
        const response = IPCMessageBuilder.embedSuccess(msg.id, vectors);
        this.messenger.send(response);
      } catch (e: any) {
        console.error(`[IPCAdapter] Embedding failed for request ${msg.id}:`, e);
        const response = IPCMessageBuilder.embedError(msg.id, e);
        this.messenger.send(response);
      }
    });

    // Handle shutdown requests
    this.router.on('shutdown', async () => {
      if (process.env.DEBUG_EMBEDDER) console.log('[IPCAdapter] Received shutdown request');
      this.core.shutdown();
      this.messenger.exit(0);
    });
  }

  /**
   * Start the IPC adapter and set up message handling
   */
  start(): void {
    if (process.env.DEBUG_EMBEDDER) console.log('[IPCAdapter] Starting IPC adapter');

    // Set up message handling
    this.messenger.onMessage(async (msg) => {
      if (process.env.DEBUG_EMBEDDER) console.log('[IPCAdapter] Received message:', msg?.type);

      const handled = await this.router.route(msg);
      if (!handled) {
        console.warn('[IPCAdapter] Unhandled message type:', msg?.type);
      }
    });

    // Handle parent process disconnect
    this.messenger.onDisconnect(() => {
      if (process.env.DEBUG_EMBEDDER) console.log('[IPCAdapter] Parent disconnected, shutting down');
      this.core.shutdown();
      this.messenger.exit(0);
    });

    // Signal that IPC is ready
    if (process.env.DEBUG_EMBEDDER) console.log('[IPCAdapter] Signaling IPC ready');
    this.messenger.send({ type: 'ipc-ready' });
  }

  /**
   * Get statistics from the core
   */
  getStats() {
    return this.core.getStats();
  }

  /**
   * Check if the adapter is ready for operations
   */
  isReady(): boolean {
    return this.core.isInitialized();
  }
}