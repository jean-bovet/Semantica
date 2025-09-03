import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { parentPort } from 'node:worker_threads';

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
      console.log(`[MODEL_DOWNLOADER] Missing: ${file.name}`);
    } else {
      const stats = fs.statSync(file.localPath);
      // Check if file is not empty (could be corrupted download)
      if (stats.size === 0) {
        missingFiles.push(file);
        console.log(`[MODEL_DOWNLOADER] Empty file (corrupted): ${file.name}`);
      } else {
        console.log(`[MODEL_DOWNLOADER] Found: ${file.name} (${(stats.size / 1024).toFixed(2)} KB)`);
      }
    }
  }

  return missingFiles;
}

/**
 * Download a single file using fetch with progress reporting
 */
async function downloadFile(file: ModelFile, onProgress: (progress: DownloadProgress) => void): Promise<void> {
  console.log(`[MODEL_DOWNLOADER] Starting download: ${file.name}`);
  console.log(`[MODEL_DOWNLOADER] From: ${file.remotePath}`);
  console.log(`[MODEL_DOWNLOADER] To: ${file.localPath}`);

  // Ensure directory exists
  const dir = path.dirname(file.localPath);
  fs.mkdirSync(dir, { recursive: true });

  try {
    // Add artificial delay in test mode
    if (process.env.E2E_MOCK_DELAYS === 'true') {
      console.log(`[MODEL_DOWNLOADER] Test mode: Adding 1 second delay for ${file.name}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Make fetch request (redirects are handled automatically)
    const response = await fetch(file.remotePath);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get total size from headers
    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    console.log(`[MODEL_DOWNLOADER] File size for ${file.name}: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

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
    const nodeStream = Readable.fromWeb(body.pipeThrough(progressStream) as any);
    const writeStream = fs.createWriteStream(file.localPath);

    // Use pipeline for proper error handling and stream management
    await pipeline(nodeStream, writeStream);

    console.log(`[MODEL_DOWNLOADER] Completed: ${file.name}`);
    
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
      } catch (unlinkErr) {
        console.error(`[MODEL_DOWNLOADER] Failed to clean up partial file: ${unlinkErr}`);
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
  console.log('[MODEL_DOWNLOADER] Starting model download...');
  
  const modelBasePath = path.join(userDataPath, 'models', 'Xenova', 'multilingual-e5-small');
  
  // Check which files need to be downloaded
  const missingFiles = checkMissingFiles(modelBasePath);
  
  if (missingFiles.length === 0) {
    console.log('[MODEL_DOWNLOADER] All model files already exist');
    return;
  }
  
  console.log(`[MODEL_DOWNLOADER] Need to download ${missingFiles.length} files`);
  
  // Download each missing file sequentially
  for (let i = 0; i < missingFiles.length; i++) {
    const file = missingFiles[i];
    console.log(`[MODEL_DOWNLOADER] Downloading ${i + 1}/${missingFiles.length}: ${file.name}`);
    
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
      
      console.log(`[MODEL_DOWNLOADER] Successfully downloaded: ${file.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[MODEL_DOWNLOADER] Failed to download ${file.name}: ${errorMessage}`);
      throw error; // Re-throw to stop the download sequence
    }
  }
  
  console.log('[MODEL_DOWNLOADER] Model download complete!');
}

/**
 * Check if model exists
 */
export function checkModelExists(modelBasePath: string): boolean {
  const onnxPath = path.join(modelBasePath, 'onnx', 'model_quantized.onnx');
  return fs.existsSync(onnxPath) && fs.statSync(onnxPath).size > 0;
}