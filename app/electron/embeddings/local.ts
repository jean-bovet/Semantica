import path from 'node:path';

let transformers: any = null;
let embedderPromise: Promise<any> | null = null;

async function getTransformers() {
  if (!transformers) {
    transformers = await import('@xenova/transformers');
    transformers.env.allowRemoteModels = false;
    transformers.env.localModelPath = process.env.NODE_ENV === 'production' 
      ? path.join(process.resourcesPath, 'models')
      : path.join(__dirname, '../../../resources/models');
  }
  return transformers;
}

export type EmbedFn = (texts: string[]) => Promise<number[][]>;
let embedImpl: EmbedFn | null = null;

export function setEmbedImpl(fn: EmbedFn) {
  embedImpl = fn;
}

async function getEmbedder() {
  if (!embedderPromise) {
    const tf = await getTransformers();
    embedderPromise = tf.pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: true }
    );
  }
  return embedderPromise;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (embedImpl) {
    return embedImpl(texts);
  }
  
  try {
    const pipe = await getEmbedder();
    const output = await pipe(texts, {
      pooling: 'mean',
      normalize: true
    });
    
    const data = output.data as Float32Array;
    const dim = output.dims[output.dims.length - 1];
    const vectors: number[][] = [];
    
    for (let i = 0; i < texts.length; i++) {
      const start = i * dim;
      const end = start + dim;
      vectors.push(Array.from(data.slice(start, end)));
    }
    
    return vectors;
  } catch (error) {
    console.error('Embedding failed:', error);
    throw error;
  }
}