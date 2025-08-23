// A tiny child process that only embeds, then exits when told.
import path from 'node:path';
import fs from 'node:fs';

let transformers: any = null;
let pipe: any = null;

async function initTransformers() {
  if (!transformers) {
    // Dynamic import for ES module
    transformers = await import('@xenova/transformers');
    
    transformers.env.allowRemoteModels = false;
    transformers.env.localModelPath = process.env.NODE_ENV === 'production' 
      ? path.join(process.resourcesPath!, 'models')
      : path.join(__dirname, '../../../resources/models');

    // Fallback to cached models if resources/models is empty
    if (!fs.existsSync(transformers.env.localModelPath)) {
      transformers.env.localModelPath = path.join(__dirname, '../../../node_modules/@xenova/transformers/.cache');
    }
  }
  return transformers;
}

process.on('message', async (msg: any) => {
  if (msg?.type === 'init') {
    try {
      const tf = await initTransformers();
      pipe = await tf.pipeline('feature-extraction', msg.model || 'Xenova/all-MiniLM-L6-v2', { quantized: true });
      process.send?.({ type: 'ready' });
    } catch (e: any) {
      process.send?.({ type: 'init:err', error: String(e) });
    }
  } else if (msg?.type === 'embed') {
    let out: any;
    try {
      out = await pipe(msg.texts, { pooling: 'mean', normalize: true });
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