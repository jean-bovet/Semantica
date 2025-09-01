// A tiny child process that only embeds, then exits when told.
import path from 'node:path';
import fs from 'node:fs';

let transformers: any = null;
let pipe: any = null;

async function initTransformers() {
  if (!transformers) {
    // Dynamic import for ES module
    transformers = await import('@xenova/transformers');
    
    // Use TRANSFORMERS_CACHE if set by parent process
    if (process.env.TRANSFORMERS_CACHE) {
      transformers.env.localModelPath = process.env.TRANSFORMERS_CACHE;
      transformers.env.cacheDir = process.env.TRANSFORMERS_CACHE;  // Also set cache directory
      // Allow downloading models on first use in production
      transformers.env.allowRemoteModels = true;
    } else if (process.env.NODE_ENV === 'production') {
      transformers.env.localModelPath = path.join(process.resourcesPath!, 'models');
      transformers.env.cacheDir = path.join(process.resourcesPath!, 'models');
      transformers.env.allowRemoteModels = false;
    } else {
      // Development mode
      transformers.env.localModelPath = path.join(__dirname, '../../../node_modules/@xenova/transformers/.cache');
      transformers.env.cacheDir = path.join(__dirname, '../../../node_modules/@xenova/transformers/.cache');
      transformers.env.allowRemoteModels = false;
    }

    console.log('Transformers cache path:', transformers.env.localModelPath);
    console.log('Allow remote models:', transformers.env.allowRemoteModels);
  }
  return transformers;
}

process.on('message', async (msg: any) => {
  if (msg?.type === 'check-model') {
    try {
      await initTransformers();
      
      // Check if model exists locally
      const modelPath = path.join(transformers.env.localModelPath, 'Xenova', 'multilingual-e5-small');
      const modelExists = fs.existsSync(path.join(modelPath, 'onnx', 'model_quantized.onnx'));
      
      process.send?.({ type: 'model:status', exists: modelExists });
    } catch (e: any) {
      process.send?.({ type: 'model:status', exists: false, error: String(e) });
    }
  } else if (msg?.type === 'init') {
    try {
      const tf = await initTransformers();
      const modelName = msg.model || 'Xenova/multilingual-e5-small';
      
      console.log(`[EMBEDDER] Initializing pipeline for ${modelName}...`);
      console.log(`[EMBEDDER] Cache path: ${transformers.env.localModelPath}`);
      
      try {
        // Model should already exist (downloaded by worker), so no progress callback needed
        console.log('[EMBEDDER] Loading model (already downloaded by worker)...');
        const startTime = Date.now();
        
        pipe = await tf.pipeline('feature-extraction', modelName, { 
          quantized: true
          // No progress_callback - model should already exist
        });
        
        const loadTime = Date.now() - startTime;
        console.log(`[EMBEDDER] Pipeline created successfully in ${loadTime}ms`);
        
        // Verify the model files exist
        const modelPath = path.join(transformers.env.localModelPath, 'Xenova', 'multilingual-e5-small', 'onnx', 'model_quantized.onnx');
        
        if (fs.existsSync(modelPath)) {
          const stats = fs.statSync(modelPath);
          console.log('[EMBEDDER] Model loaded! Size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
          process.send?.({ type: 'ready' });
        } else {
          console.error('[EMBEDDER] ERROR: Model file not found:', modelPath);
          throw new Error('Model file not found - should have been downloaded by worker');
        }
      } catch (pipeError: any) {
        console.error('Pipeline creation error:', pipeError);
        throw pipeError;
      }
    } catch (e: any) {
      console.error('Pipeline initialization failed:', e);
      process.send?.({ type: 'init:err', error: String(e) });
    }
  } else if (msg?.type === 'embed') {
    let out: any;
    try {
      // Add E5 prefixes based on type
      const prefixedTexts = msg.texts.map((text: string) => {
        // Use passage: for documents, query: for search queries
        const prefix = msg.isQuery ? 'query: ' : 'passage: ';
        return prefix + text;
      });
      
      out = await pipe(prefixedTexts, { pooling: 'mean', normalize: true });
      const dim = out.dims.at(-1) ?? 384;
      const data = out.data as Float32Array;
      // copy into plain arrays so parent doesn't hold native buffers
      const res: number[][] = [];
      for (let i = 0; i < data.length; i += dim) {
        const v = new Array(dim);
        for (let j = 0; j < dim; j++) v[j] = data[i + j];
        res.push(v);
      }
      process.send?.({ type: 'embed:ok', id: msg.id, vectors: res });
    } catch (e: any) {
      process.send?.({ type: 'embed:err', id: msg.id, error: String(e) });
    } finally {
      if (out?.dispose) out.dispose();
      if (global.gc) global.gc();
    }
  } else if (msg?.type === 'shutdown') {
    process.exit(0);
  }
});

// Handle parent disconnect
process.on('disconnect', () => {
  process.exit(0);
});