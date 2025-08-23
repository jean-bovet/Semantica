#!/usr/bin/env node

import { pipeline } from '@xenova/transformers';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function downloadModel() {
  console.log('Downloading model for testing...');
  
  const modelPath = path.join(__dirname, '../resources/models');
  fs.mkdirSync(modelPath, { recursive: true });
  
  // This will download the model to the cache directory
  // We'll use the default cache for now as transformers.js handles it
  console.log('Initializing embeddings pipeline with all-MiniLM-L6-v2...');
  
  try {
    const pipe = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: true }
    );
    
    console.log('Model downloaded successfully!');
    
    // Test the model
    const output = await pipe(['test'], {
      pooling: 'mean',
      normalize: true
    });
    
    console.log('Model test successful. Embedding dimension:', output.dims);
  } catch (error) {
    console.error('Failed to download model:', error);
    process.exit(1);
  }
}

downloadModel();