// A tiny child process that only embeds, then exits when told.
import { SerialQueue } from '../../shared/utils/SerialQueue';
import { ModelPathResolver } from '../../shared/embeddings/ModelPathResolver';
import { EmbeddingProcessor } from '../../shared/embeddings/EmbeddingProcessor';
import { IPCMessageRouter, IPCMessageBuilder, MessageTypeGuards } from '../../shared/embeddings/IPCMessageProtocol';

let transformers: any = null;
let pipe: any = null;

// Use the new SerialQueue utility for embedding operations
const embeddingQueue = new SerialQueue<number[][]>();
const embeddingProcessor = new EmbeddingProcessor();
const messageRouter = new IPCMessageRouter();

async function embedSerial(texts: string[], isQuery = false): Promise<number[][]> {
  return embeddingQueue.add(async () => {
    let out: any;
    try {
      // Use EmbeddingProcessor to add prefixes
      const prefixedTexts = embeddingProcessor.addPrefixes(texts, isQuery);

      out = await pipe(prefixedTexts, { pooling: 'mean', normalize: true });

      // Use EmbeddingProcessor to convert vectors
      const { vectors } = embeddingProcessor.processEmbedding(texts, out, isQuery);

      return vectors;
    } catch (e: any) {
      throw e;
    } finally {
      if (out) {
        embeddingProcessor.cleanup(out);
      }
      if (global.gc) global.gc();
    }
  });
}

async function initTransformers() {
  if (!transformers) {
    // Dynamic import for ES module
    transformers = await import('@xenova/transformers');

    // Use ModelPathResolver to get environment-appropriate paths
    const pathResolver = new ModelPathResolver();
    const resolved = pathResolver.resolve();

    transformers.env.localModelPath = resolved.localModelPath;
    transformers.env.cacheDir = resolved.cacheDir;
    transformers.env.allowRemoteModels = resolved.allowRemoteModels;

    console.log('Transformers cache path:', transformers.env.localModelPath);
    console.log('Allow remote models:', transformers.env.allowRemoteModels);
  }
  return transformers;
}

// Set up message handlers using the router
messageRouter.on('check-model', async () => {
  try {
    await initTransformers();

    // Use ModelPathResolver to check model existence
    const pathResolver = new ModelPathResolver();
    const modelInfo = pathResolver.getModelInfo();

    const response = IPCMessageBuilder.modelStatus(modelInfo.exists);
    process.send?.(response);
  } catch (e: any) {
    const response = IPCMessageBuilder.modelStatus(false, String(e));
    process.send?.(response);
  }
});

messageRouter.on('init', async (msg) => {
  if (!MessageTypeGuards.isInitMessage(msg)) return;

  try {
    const tf = await initTransformers();
    const modelName = msg.model || 'Xenova/multilingual-e5-small';

    console.log(`[EMBEDDER] Initializing pipeline for ${modelName}...`);
    console.log(`[EMBEDDER] Cache path: ${transformers.env.localModelPath}`);

    try {
      console.log('[EMBEDDER] Loading model (already downloaded by worker)...');
      const startTime = Date.now();

      pipe = await tf.pipeline('feature-extraction', modelName, {
        quantized: true
      });

      const loadTime = Date.now() - startTime;
      console.log(`[EMBEDDER] Pipeline created successfully in ${loadTime}ms`);

      // Use ModelPathResolver to verify model file
      const pathResolver = new ModelPathResolver(modelName);
      const modelInfo = pathResolver.getModelInfo();

      if (modelInfo.exists && modelInfo.size) {
        console.log('[EMBEDDER] Model loaded! Size:', (modelInfo.size / 1024 / 1024).toFixed(2), 'MB');
        const response = IPCMessageBuilder.ready();
        process.send?.(response);
      } else {
        console.error('[EMBEDDER] ERROR: Model file not found:', modelInfo.path);
        throw new Error('Model file not found - should have been downloaded by worker');
      }
    } catch (pipeError: any) {
      console.error('Pipeline creation error:', pipeError);
      throw pipeError;
    }
  } catch (e: any) {
    console.error('Pipeline initialization failed:', e);
    const response = IPCMessageBuilder.initError(e);
    process.send?.(response);
  }
});

messageRouter.on('embed', async (msg) => {
  if (!MessageTypeGuards.isEmbedMessage(msg)) return;

  try {
    const result = await embedSerial(msg.texts, msg.isQuery);
    const response = IPCMessageBuilder.embedSuccess(msg.id, result);
    process.send?.(response);
  } catch (e: any) {
    const response = IPCMessageBuilder.embedError(msg.id, e);
    process.send?.(response);
  }
});

messageRouter.on('shutdown', async () => {
  embeddingQueue.shutdown();
  process.exit(0);
});

// Route incoming messages
process.on('message', async (msg: any) => {
  const handled = await messageRouter.route(msg);
  if (!handled) {
    console.warn('[EMBEDDER] Unhandled message type:', msg?.type);
  }
});

// Handle parent disconnect
process.on('disconnect', () => {
  process.exit(0);
});