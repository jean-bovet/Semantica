import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
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
 * Download a single file with progress reporting
 */
function downloadFile(file: ModelFile, onProgress: (progress: DownloadProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[MODEL_DOWNLOADER] Starting download: ${file.name}`);
    console.log(`[MODEL_DOWNLOADER] From: ${file.remotePath}`);
    console.log(`[MODEL_DOWNLOADER] To: ${file.localPath}`);

    // Ensure directory exists
    const dir = path.dirname(file.localPath);
    fs.mkdirSync(dir, { recursive: true });

    // Create write stream
    const writeStream = fs.createWriteStream(file.localPath);
    let downloadedBytes = 0;
    let totalBytes = 0;

    // Make HTTPS request
    https.get(file.remotePath, (response) => {
      // Handle redirects (including 307 temporary redirects)
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307 || response.statusCode === 308) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          console.log(`[MODEL_DOWNLOADER] Following redirect (${response.statusCode}) for ${file.name}`);
          // Handle both relative and absolute redirect URLs
          const fullRedirectUrl = redirectUrl.startsWith('http') ? redirectUrl : `${HF_BASE_URL}${redirectUrl}`;
          https.get(fullRedirectUrl, (redirectResponse) => {
            handleResponse(redirectResponse);
          }).on('error', (err) => {
            if (fs.existsSync(file.localPath)) {
              fs.unlinkSync(file.localPath); // Clean up partial file
            }
            reject(new Error(`Failed to download ${file.name}: ${err.message}`));
          });
        } else {
          reject(new Error(`Redirect without location for ${file.name}`));
        }
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${file.name}: HTTP ${response.statusCode}`));
        return;
      }

      handleResponse(response);
    }).on('error', (err) => {
      if (fs.existsSync(file.localPath)) {
        fs.unlinkSync(file.localPath); // Clean up partial file
      }
      reject(new Error(`Failed to download ${file.name}: ${err.message}`));
    });

    function handleResponse(response: any) {
      totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      console.log(`[MODEL_DOWNLOADER] File size for ${file.name}: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

      response.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;
        writeStream.write(chunk);

        const progress = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
        
        onProgress({
          file: file.name,
          progress,
          loaded: downloadedBytes,
          total: totalBytes,
          status: 'downloading'
        });
      });

      response.on('end', () => {
        writeStream.end();
        console.log(`[MODEL_DOWNLOADER] Completed: ${file.name}`);
        
        onProgress({
          file: file.name,
          progress: 100,
          loaded: totalBytes,
          total: totalBytes,
          status: 'completed'
        });
        
        resolve();
      });

      response.on('error', (err: Error) => {
        writeStream.destroy();
        if (fs.existsSync(file.localPath)) {
          fs.unlinkSync(file.localPath);
        }
        reject(new Error(`Download stream error for ${file.name}: ${err.message}`));
      });
    }
  });
}

/**
 * Download model files sequentially
 */
export async function downloadModelSequentially(userDataPath: string): Promise<void> {
  const modelBasePath = path.join(userDataPath, 'models', 'Xenova', 'multilingual-e5-small');
  
  // Check which files are missing
  const missingFiles = checkMissingFiles(modelBasePath);
  
  if (missingFiles.length === 0) {
    console.log('[MODEL_DOWNLOADER] All model files are present');
    return;
  }

  console.log(`[MODEL_DOWNLOADER] Need to download ${missingFiles.length} files`);
  
  let completedFiles = 0;
  const totalFiles = missingFiles.length;

  // Download each missing file sequentially
  for (const file of missingFiles) {
    try {
      await downloadFile(file, (progress) => {
        // Send progress to main process
        if (parentPort) {
          parentPort.postMessage({
            type: 'model:download:progress',
            payload: {
              file: progress.file,
              progress: progress.progress,
              loaded: progress.loaded,
              total: progress.total,
              modelName: MODEL_NAME,
              status: progress.status,
              currentFileIndex: completedFiles + 1,
              totalFiles,
              overallProgress: Math.round(((completedFiles + (progress.progress / 100)) / totalFiles) * 100)
            }
          });
        }
      });
      
      completedFiles++;
      console.log(`[MODEL_DOWNLOADER] Progress: ${completedFiles}/${totalFiles} files completed`);
      
    } catch (err) {
      console.error(`[MODEL_DOWNLOADER] Failed to download ${file.name}:`, err);
      throw err; // Stop on first error
    }
  }

  // Verify all files are now present
  const stillMissing = checkMissingFiles(modelBasePath);
  if (stillMissing.length > 0) {
    throw new Error(`Failed to download all required files. Still missing: ${stillMissing.map(f => f.name).join(', ')}`);
  }

  console.log('[MODEL_DOWNLOADER] All model files downloaded successfully');
}

/**
 * Check if model exists (all required files are present)
 */
export function checkModelExists(userDataPath: string): boolean {
  const modelBasePath = path.join(userDataPath, 'models', 'Xenova', 'multilingual-e5-small');
  const missingFiles = checkMissingFiles(modelBasePath);
  return missingFiles.length === 0;
}