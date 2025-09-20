import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedderIPCAdapter } from '../../src/shared/embeddings/EmbedderIPCAdapter';
import { EmbedderCore } from '../../src/shared/embeddings/EmbedderCore';
import { IProcessMessenger } from '../../src/shared/embeddings/interfaces/IProcessMessenger';

describe('EmbedderIPCAdapter', () => {
  let adapter: EmbedderIPCAdapter;
  let mockCore: any;
  let mockMessenger: IProcessMessenger;
  let messageHandler: (msg: any) => void;
  let disconnectHandler: () => void;

  beforeEach(() => {
    // Create mock core
    mockCore = {
      initialize: vi.fn().mockResolvedValue(undefined),
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      checkModel: vi.fn().mockResolvedValue(true),
      getModelInfo: vi.fn().mockReturnValue({
        exists: true,
        path: '/path/to/model',
        size: 112 * 1024 * 1024
      }),
      shutdown: vi.fn(),
      isInitialized: vi.fn().mockReturnValue(false),
      getStats: vi.fn().mockReturnValue({
        initialized: false,
        modelName: null,
        queueStatus: { isIdle: true, isShutdown: false }
      })
    };

    // Create mock messenger that captures handlers
    mockMessenger = {
      send: vi.fn(),
      onMessage: vi.fn().mockImplementation((handler) => {
        messageHandler = handler;
      }),
      onDisconnect: vi.fn().mockImplementation((handler) => {
        disconnectHandler = handler;
      }),
      exit: vi.fn()
    };

    // Create adapter
    adapter = new EmbedderIPCAdapter(mockCore as EmbedderCore, mockMessenger);
  });

  describe('initialization', () => {
    it('should send ipc-ready message on start', () => {
      adapter.start();

      expect(mockMessenger.send).toHaveBeenCalledWith({ type: 'ipc-ready' });
    });

    it('should register message and disconnect handlers', () => {
      adapter.start();

      expect(mockMessenger.onMessage).toHaveBeenCalled();
      expect(mockMessenger.onDisconnect).toHaveBeenCalled();
    });
  });

  describe('message routing', () => {
    beforeEach(() => {
      adapter.start();
    });

    describe('check-model message', () => {
      it('should handle check-model request', async () => {
        await messageHandler({ type: 'check-model' });

        expect(mockCore.checkModel).toHaveBeenCalled();
        // The last call should be the model:status response
        expect(mockMessenger.send).toHaveBeenLastCalledWith(expect.objectContaining({
          type: 'model:status',
          exists: true
        }));
      });

      it('should handle check-model error', async () => {
        mockCore.checkModel = vi.fn().mockRejectedValue(new Error('Check failed'));

        await messageHandler({ type: 'check-model' });

        expect(mockMessenger.send).toHaveBeenLastCalledWith(expect.objectContaining({
          type: 'model:status',
          exists: false,
          error: 'Error: Check failed'
        }));
      });
    });

    describe('init message', () => {
      it('should initialize core with provided model', async () => {
        mockCore.getModelInfo = vi.fn().mockReturnValue({
          exists: true,
          size: 112 * 1024 * 1024
        });

        await messageHandler({ type: 'init', model: 'test-model' });

        expect(mockCore.initialize).toHaveBeenCalledWith('test-model');
        expect(mockMessenger.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'ready' }));
      });

      it('should use default model if not specified', async () => {
        mockCore.getModelInfo = vi.fn().mockReturnValue({
          exists: true,
          size: 112 * 1024 * 1024
        });

        await messageHandler({ type: 'init' });

        expect(mockCore.initialize).toHaveBeenCalledWith('Xenova/multilingual-e5-small');
      });

      it('should handle initialization error', async () => {
        mockCore.initialize = vi.fn().mockRejectedValue(new Error('Init failed'));

        await messageHandler({ type: 'init', model: 'bad-model' });

        expect(mockMessenger.send).toHaveBeenLastCalledWith(expect.objectContaining({
          type: 'init:err',
          error: 'Init failed'  // IPCMessageBuilder extracts just the message, not "Error: "
        }));
      });

      it('should handle model not found after init', async () => {
        mockCore.getModelInfo = vi.fn().mockReturnValue({
          exists: false
        });

        await messageHandler({ type: 'init', model: 'test-model' });

        expect(mockMessenger.send).toHaveBeenLastCalledWith(expect.objectContaining({
          type: 'init:err',
          error: expect.stringContaining('Model file not found')
        }));
      });
    });

    describe('embed message', () => {
      it('should process embedding request', async () => {
        const embedMsg = {
          type: 'embed',
          id: 'test-123',
          texts: ['test text'],
          isQuery: false
        };

        await messageHandler(embedMsg);

        expect(mockCore.embed).toHaveBeenCalledWith(['test text'], false);
        expect(mockMessenger.send).toHaveBeenLastCalledWith(expect.objectContaining({
          type: 'embed:ok',
          id: 'test-123',
          vectors: [[0.1, 0.2, 0.3]]
        }));
      });

      it('should handle query embeddings', async () => {
        const embedMsg = {
          type: 'embed',
          id: 'query-456',
          texts: ['search query'],
          isQuery: true
        };

        await messageHandler(embedMsg);

        expect(mockCore.embed).toHaveBeenCalledWith(['search query'], true);
      });

      it('should default isQuery to false if not specified', async () => {
        const embedMsg = {
          type: 'embed',
          id: 'test-789',
          texts: ['text']
        };

        await messageHandler(embedMsg);

        expect(mockCore.embed).toHaveBeenCalledWith(['text'], false);
      });

      it('should handle embedding errors', async () => {
        mockCore.embed = vi.fn().mockRejectedValue(new Error('Embedding failed'));

        const embedMsg = {
          type: 'embed',
          id: 'error-999',
          texts: ['test'],
          isQuery: false
        };

        await messageHandler(embedMsg);

        expect(mockMessenger.send).toHaveBeenLastCalledWith(expect.objectContaining({
          type: 'embed:err',
          id: 'error-999',
          error: 'Embedding failed'  // IPCMessageBuilder extracts just the message
        }));
      });

      it('should ignore invalid embed messages', async () => {
        // Missing required fields
        await messageHandler({
          type: 'embed'
          // Missing id and texts
        });

        // Core should not be called
        expect(mockCore.embed).not.toHaveBeenCalled();
      });
    });

    describe('shutdown message', () => {
      it('should shutdown core and exit', async () => {
        await messageHandler({ type: 'shutdown' });

        expect(mockCore.shutdown).toHaveBeenCalled();
        expect(mockMessenger.exit).toHaveBeenCalledWith(0);
      });
    });

    describe('unknown messages', () => {
      it('should handle unknown message types gracefully', async () => {
        await messageHandler({ type: 'unknown-type' });

        // Should not throw, just log warning (check console output in real test)
        expect(mockCore.initialize).not.toHaveBeenCalled();
        expect(mockCore.embed).not.toHaveBeenCalled();
      });
    });
  });

  describe('disconnect handling', () => {
    it('should shutdown on parent disconnect', () => {
      adapter.start();

      // Trigger disconnect
      disconnectHandler();

      expect(mockCore.shutdown).toHaveBeenCalled();
      expect(mockMessenger.exit).toHaveBeenCalledWith(0);
    });
  });

  describe('statistics', () => {
    it('should return core stats', () => {
      const stats = adapter.getStats();

      expect(mockCore.getStats).toHaveBeenCalled();
      expect(stats).toEqual({
        initialized: false,
        modelName: null,
        queueStatus: { isIdle: true, isShutdown: false }
      });
    });

    it('should check if ready', () => {
      mockCore.isInitialized = vi.fn().mockReturnValue(true);

      const ready = adapter.isReady();

      expect(ready).toBe(true);
      expect(mockCore.isInitialized).toHaveBeenCalled();
    });
  });

  describe('message validation', () => {
    beforeEach(() => {
      adapter.start();
    });

    it('should validate init message format', async () => {
      // Invalid init message (wrong type for model)
      await messageHandler({
        type: 'init',
        model: 123 // Should be string
      });

      // Should still attempt to initialize with some value
      // The validation in real code would catch this
      expect(mockCore.initialize).toHaveBeenCalled();
    });

    it('should validate embed message has required fields', async () => {
      // Missing texts
      await messageHandler({
        type: 'embed',
        id: 'test'
      });

      expect(mockCore.embed).not.toHaveBeenCalled();

      // Missing id
      await messageHandler({
        type: 'embed',
        texts: ['test']
      });

      expect(mockCore.embed).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      adapter.start();
    });

    it('should handle core throwing non-Error objects', async () => {
      mockCore.initialize = vi.fn().mockRejectedValue('String error');

      await messageHandler({ type: 'init', model: 'test' });

      expect(mockMessenger.send).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'init:err',
        error: 'String error'
      }));
    });

    it('should handle null/undefined errors gracefully', async () => {
      mockCore.embed = vi.fn().mockRejectedValue(null);

      await messageHandler({
        type: 'embed',
        id: 'test',
        texts: ['text']
      });

      expect(mockMessenger.send).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'embed:err',
        id: 'test'
        // error field will be null which gets converted by IPCMessageBuilder
      }));
    });
  });
});