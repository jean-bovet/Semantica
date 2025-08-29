import { describe, it, expect } from 'vitest';
import { chunkText } from '../../src/main/pipeline/chunker';
import { ConfigManager } from '../../src/main/worker/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Fast Unit Tests - Pure Functions', () => {
  
  describe('Text Chunking', () => {
    it('should chunk text correctly', () => {
      const text = 'This is a test. '.repeat(50);
      const chunks = chunkText(text, 100, 20);
      
      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach(chunk => {
        expect(chunk.text.length).toBeGreaterThan(0);
        expect(chunk.offset).toBeGreaterThanOrEqual(0);
      });
    });

    it('should handle empty text', () => {
      const chunks = chunkText('', 100, 20);
      expect(chunks).toEqual([]);
    });

    it('should handle single word', () => {
      const chunks = chunkText('word', 100, 20);
      expect(chunks.length).toBe(1);
      expect(chunks[0].text).toBe('word');
    });
  });

  describe('Config Manager - Fast Operations', () => {
    it('should create default config', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-fast-'));
      try {
        const config = new ConfigManager(tempDir);
        const cfg = config.getConfig();
        
        expect(cfg.version).toBe('1.0.0');
        expect(cfg.watchedFolders).toEqual([]);
        expect(cfg.settings.cpuThrottle).toBe('medium');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should update watched folders', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-fast-'));
      try {
        const config = new ConfigManager(tempDir);
        const folders = ['/test1', '/test2'];
        
        config.setWatchedFolders(folders);
        expect(config.getWatchedFolders()).toEqual(folders);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Score Calculation', () => {
    it('should convert distance to similarity score', () => {
      // Simulating the score calculation from worker
      const calculateScore = (distance: number | undefined) => {
        return distance !== undefined ? Math.max(0, 1 - (distance / 2)) : 1;
      };

      expect(calculateScore(0)).toBe(1);      // Perfect match
      expect(calculateScore(1)).toBe(0.5);    // Medium similarity
      expect(calculateScore(2)).toBe(0);      // No similarity
      expect(calculateScore(undefined)).toBe(1); // Default
    });
  });

  describe('File Type Detection', () => {
    it('should identify supported file types', () => {
      const supported = ['pdf', 'txt', 'md', 'docx', 'rtf', 'doc'];
      
      const isSupported = (filePath: string) => {
        const ext = path.extname(filePath).slice(1).toLowerCase();
        return supported.includes(ext);
      };

      expect(isSupported('test.txt')).toBe(true);
      expect(isSupported('test.pdf')).toBe(true);
      expect(isSupported('test.jpg')).toBe(false);
      expect(isSupported('test.json')).toBe(false);
    });
  });

  describe('Path Operations', () => {
    it('should extract file extension correctly', () => {
      const getExt = (filePath: string) => path.extname(filePath).slice(1).toLowerCase();
      
      expect(getExt('file.txt')).toBe('txt');
      expect(getExt('file.PDF')).toBe('pdf');
      expect(getExt('no-extension')).toBe('');
      expect(getExt('.hidden')).toBe('');
    });

    it('should check if path is in folder', () => {
      const isInFolder = (filePath: string, folder: string) => filePath.startsWith(folder);
      
      expect(isInFolder('/users/test/file.txt', '/users/test')).toBe(true);
      expect(isInFolder('/users/test/file.txt', '/users/other')).toBe(false);
    });
  });
});