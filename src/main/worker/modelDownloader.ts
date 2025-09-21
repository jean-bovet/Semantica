import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { parentPort } from 'node:worker_threads';
// Don't import fetch - use the global one that can be mocked

const MODEL_NAME = 'Xenova/multilingual-e5-small';
const HF_BASE_URL = 'https://huggingface.co';

interface ModelFile {
  name: string;
  remotePath: string;
  localPath: string;
  size?: number; // Expected size in bytes (optional, for validation)
}

interface DownloadProgress {
  file: string;
  progress: number;
  loaded: number;
  total: number;
  status: string;
}

/**
 * Get list of required model files with their paths
 */
function getModelFiles(modelBasePath: string): ModelFile[] {
  return [
    {
      name: 'config.json',
      remotePath: `${HF_BASE_URL}/${MODEL_NAME}/resolve/main/config.json`,
      localPath: path.join(modelBasePath, 'config.json')
    },
    {
      name: 'tokenizer_config.json',
      remotePath: `${HF_BASE_URL}/${MODEL_NAME}/resolve/main/tokenizer_config.json`,
      localPath: path.join(modelBasePath, 'tokenizer_config.json')
    },
    {
      name: 'tokenizer.json',
      remotePath: `${HF_BASE_URL}/${MODEL_NAME}/resolve/main/tokenizer.json`,
      localPath: path.join(modelBasePath, 'tokenizer.json')
    },
    {
      name: 'special_tokens_map.json',
      remotePath: `${HF_BASE_URL}/${MODEL_NAME}/resolve/main/special_tokens_map.json`,
      localPath: path.join(modelBasePath, 'special_tokens_map.json')
    },
    {
      name: 'model_quantized.onnx',
      remotePath: `${HF_BASE_URL}/${MODEL_NAME}/resolve/main/onnx/model_quantized.onnx`,
      localPath: path.join(modelBasePath, 'onnx', 'model_quantized.onnx')
    }
  ];
}

/**
 * Check which model files are missing or incomplete
 */
export function checkMissingFiles(modelBasePath: string): ModelFile[] {
  const allFiles = getModelFiles(modelBasePath);
  const missingFiles: ModelFile[] = [];

  for (const file of allFiles) {
    if (!fs.existsSync(file.localPath)) {
      missingFiles.push(file);
    } else {
      const stats = fs.statSync(file.localPath);
      // Check if file is not empty (could be corrupted download)
      if (stats.size === 0) {
        missingFiles.push(file);
      }
    }
  }

  return missingFiles;
}

/**
 * Download a single file using fetch with progress reporting
 */
async function downloadFile(file: ModelFile, onProgress: (progress: DownloadProgress) => void): Promise<void> {
  // Ensure directory exists
  const dir = path.dirname(file.localPath);
  fs.mkdirSync(dir, { recursive: true });

  try {
    // Make fetch request (redirects are handled automatically)
    const response = await fetch(file.remotePath);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get total size from headers
    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    // Get the response body as a readable stream
    const body = response.body;
    if (!body) {
      throw new Error('Response body is null');
    }

    // Track downloaded bytes for progress
    let downloadedBytes = 0;

    // Create a transform stream to track progress
    const progressStream = new TransformStream({
      transform(chunk, controller) {
        downloadedBytes += chunk.length;
        
        const progress = totalBytes > 0 
          ? Math.round((downloadedBytes / totalBytes) * 100) 
          : 0;
        
        onProgress({
          file: file.name,
          progress,
          loaded: downloadedBytes,
          total: totalBytes,
          status: 'downloading'
        });
        
        controller.enqueue(chunk);
      }
    });

    // Convert web stream to Node stream for file writing
    // @ts-ignore - Type mismatch between web streams and Node streams
    const nodeStream = Readable.fromWeb(body.pipeThrough(progressStream));
    const writeStream = fs.createWriteStream(file.localPath);

    // Use pipeline for proper error handling and stream management
    await pipeline(nodeStream, writeStream);
    
    onProgress({
      file: file.name,
      progress: 100,
      loaded: totalBytes,
      total: totalBytes,
      status: 'completed'
    });

  } catch (error) {
    // Clean up partial file on error
    if (fs.existsSync(file.localPath)) {
      try {
        fs.unlinkSync(file.localPath);
      } catch (_unlinkErr) {
        // Ignore cleanup errors
      }
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download ${file.name}: ${errorMessage}`);
  }
}

/**
 * Download model files sequentially
 */
export async function downloadModelSequentially(userDataPath: string): Promise<void> {
  const modelBasePath = path.join(userDataPath, 'models', 'Xenova', 'multilingual-e5-small');
  
  // Check which files need to be downloaded
  const missingFiles = checkMissingFiles(modelBasePath);
  
  if (missingFiles.length === 0) {
    return;
  }
  
  // Download each missing file sequentially
  for (let i = 0; i < missingFiles.length; i++) {
    const file = missingFiles[i];
    
    try {
      await downloadFile(file, (progress) => {
        // Send progress to parent if in worker thread
        if (parentPort) {
          parentPort.postMessage({
            type: 'model:download:progress',
            payload: progress
          });
        }
      });
    } catch (error) {
      throw error; // Re-throw to stop the download sequence
    }
  }
}

/**
 * Check if model exists
 */
export function checkModelExists(modelBasePath: string): boolean {
  const onnxPath = path.join(modelBasePath, 'onnx', 'model_quantized.onnx');
  return fs.existsSync(onnxPath) && fs.statSync(onnxPath).size > 0;
}