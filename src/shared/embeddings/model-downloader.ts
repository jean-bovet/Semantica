import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

export class ModelDownloader {
  private modelPath: string;
  private modelUrl = 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx';
  private modelSize = 118 * 1024 * 1024; // Approximate size in bytes
  
  constructor() {
    this.modelPath = path.join(app.getPath('userData'), 'models', 'Xenova', 'multilingual-e5-small', 'onnx');
  }
  
  async ensureModelExists(): Promise<boolean> {
    const modelFile = path.join(this.modelPath, 'model_quantized.onnx');
    
    if (fs.existsSync(modelFile)) {
      console.log('Model already exists at:', modelFile);
      return true;
    }
    
    console.log('Model not found, downloading...');
    return this.downloadModel();
  }
  
  private async downloadModel(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // Create directory structure
      fs.mkdirSync(this.modelPath, { recursive: true });
      
      const modelFile = path.join(this.modelPath, 'model_quantized.onnx');
      const tempFile = modelFile + '.tmp';
      
      // Download tokenizer and config files first
      this.downloadSupportFiles().then(() => {
        const file = fs.createWriteStream(tempFile);
        let downloadedBytes = 0;
        let lastProgress = 0;
        
        https.get(this.modelUrl, (response) => {
          const totalBytes = parseInt(response.headers['content-length'] || '0', 10) || this.modelSize;
          
          response.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            file.write(chunk);
            
            const progress = Math.floor((downloadedBytes / totalBytes) * 100);
            if (progress !== lastProgress) {
              lastProgress = progress;
              this.notifyProgress(progress);
            }
          });
          
          response.on('end', () => {
            file.end();
            // Rename temp file to final name
            fs.renameSync(tempFile, modelFile);
            console.log('Model download complete');
            resolve(true);
          });
          
          response.on('error', (err) => {
            console.error('Download error:', err);
            fs.unlinkSync(tempFile);
            reject(err);
          });
        });
      }).catch(reject);
    });
  }
  
  private async downloadSupportFiles(): Promise<void> {
    const files = [
      { name: 'config.json', url: 'https://huggingface.co/Xenova/multilingual-e5-small/raw/main/config.json' },
      { name: 'tokenizer.json', url: 'https://huggingface.co/Xenova/multilingual-e5-small/raw/main/tokenizer.json' },
      { name: 'tokenizer_config.json', url: 'https://huggingface.co/Xenova/multilingual-e5-small/raw/main/tokenizer_config.json' }
    ];
    
    for (const file of files) {
      const filePath = path.join(this.modelPath, '..', file.name);
      if (!fs.existsSync(filePath)) {
        await this.downloadFile(file.url, filePath);
      }
    }
  }
  
  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }
  
  private notifyProgress(progress: number) {
    // Send progress to all windows
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      window.webContents.send('model-download-progress', { progress });
    });
  }
}

// Singleton instance
let downloader: ModelDownloader | null = null;

export function getModelDownloader(): ModelDownloader {
  if (!downloader) {
    downloader = new ModelDownloader();
  }
  return downloader;
}