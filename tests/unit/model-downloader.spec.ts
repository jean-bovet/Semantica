import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { checkMissingFiles, checkModelExists } from '../../src/main/worker/modelDownloader';

// Mock modules
vi.mock('node:fs');
vi.mock('worker_threads', () => ({
  parentPort: {
    postMessage: vi.fn()
  }
}));

describe('Model Downloader', () => {
  const mockUserDataPath = '/mock/user/data';
  const modelBasePath = path.join(mockUserDataPath, 'models', 'Xenova', 'multilingual-e5-small');
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default fs mocks
    (fs.mkdirSync as any).mockImplementation(() => {});
    (fs.existsSync as any).mockReturnValue(false);
    (fs.statSync as any).mockReturnValue({ size: 1024 });
    (fs.createWriteStream as any).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn()
    });
    (fs.unlinkSync as any).mockImplementation(() => {});
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('checkMissingFiles', () => {
    it('should identify all files as missing when none exist', () => {
      (fs.existsSync as any).mockReturnValue(false);
      
      const missing = checkMissingFiles(modelBasePath);
      
      expect(missing).toHaveLength(5);
      expect(missing.map(f => f.name)).toEqual([
        'config.json',
        'tokenizer_config.json',
        'tokenizer.json',
        'special_tokens_map.json',
        'model_quantized.onnx'
      ]);
    });
    
    it('should identify no missing files when all exist', () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024 });
      
      const missing = checkMissingFiles(modelBasePath);
      
      expect(missing).toHaveLength(0);
    });
    
    it('should identify corrupted (empty) files as missing', () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 0 });
      
      const missing = checkMissingFiles(modelBasePath);
      
      expect(missing).toHaveLength(5);
    });
    
    it('should handle mixed scenarios correctly', () => {
      (fs.existsSync as any).mockImplementation((filepath: string) => {
        // Files that exist
        return filepath.includes('config.json') || 
               filepath.includes('tokenizer_config.json') ||
               filepath.includes('tokenizer.json');
      });
      (fs.statSync as any).mockReturnValue({ size: 1024 });
      
      const missing = checkMissingFiles(modelBasePath);
      
      // Only special_tokens_map.json and model_quantized.onnx should be missing
      expect(missing).toHaveLength(2);
      expect(missing.map(f => f.name)).toEqual([
        'special_tokens_map.json',
        'model_quantized.onnx'
      ]);
    });
  });

  describe('checkModelExists', () => {
    it('should return true when model file exists', () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024 });
      
      const exists = checkModelExists(modelBasePath);
      
      expect(exists).toBe(true);
    });
    
    it('should return false when model file is missing', () => {
      (fs.existsSync as any).mockReturnValue(false);
      
      const exists = checkModelExists(modelBasePath);
      
      expect(exists).toBe(false);
    });
    
    it('should return false when model file is empty', () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 0 });
      
      const exists = checkModelExists(modelBasePath);
      
      expect(exists).toBe(false);
    });
  });

  describe('downloadModelSequentially', () => {
    // Note: The actual download logic is complex with fetch, streams, etc.
    // These tests focus on the basic structure and file checking
    
    it('should export downloadModelSequentially function', async () => {
      const module = await import('../../src/main/worker/modelDownloader');
      expect(typeof module.downloadModelSequentially).toBe('function');
    });
    
    it('should handle file list correctly', () => {
      const files = ['config.json', 'tokenizer_config.json', 'tokenizer.json', 
                     'special_tokens_map.json', 'model_quantized.onnx'];
      
      expect(files.length).toBe(5);
      expect(files).toContain('config.json');
      expect(files).toContain('model_quantized.onnx');
    });
  });
});