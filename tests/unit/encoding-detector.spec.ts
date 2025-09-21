import { describe, it, expect, vi } from 'vitest';
import { detectEncoding, decodeBuffer } from '../../src/main/utils/encoding-detector';
import iconv from 'iconv-lite';
import { logger } from '../../src/shared/utils/logger';

describe('Encoding Detector Utility', () => {
  describe('detectEncoding', () => {
    it('should detect UTF-16LE with BOM', () => {
      const buffer = Buffer.from([0xFF, 0xFE, 0x48, 0x00, 0x69, 0x00]); // "Hi" in UTF-16LE with BOM
      const encoding = detectEncoding(buffer);
      expect(encoding).toBe('utf16le');
    });

    it('should detect UTF-16BE with BOM', () => {
      const buffer = Buffer.from([0xFE, 0xFF, 0x00, 0x48, 0x00, 0x69]); // "Hi" in UTF-16BE with BOM
      const encoding = detectEncoding(buffer);
      expect(encoding).toBe('utf16be');
    });

    it('should detect UTF-16LE without BOM using heuristics', () => {
      // "This is UTF-16LE text" without BOM
      const text = 'This is UTF-16LE text with many ASCII characters';
      const buffer = iconv.encode(text, 'utf16le');
      const encoding = detectEncoding(buffer);
      expect(encoding).toBe('utf16le');
    });

    it('should detect UTF-8', () => {
      const buffer = Buffer.from('Hello world with UTF-8: café, naïve, €100');
      const encoding = detectEncoding(buffer);
      expect(encoding).toBe('UTF-8');
    });

    it('should detect ISO-8859 family encodings', () => {
      const buffer = iconv.encode('café naïve', 'ISO-8859-1');
      const encoding = detectEncoding(buffer);
      // Chardet may detect various ISO-8859 variants which are similar
      expect(encoding).toMatch(/ISO-8859-\d+/);
    });

    it('should detect Windows-1252', () => {
      const buffer = iconv.encode('smart quotes "" and café', 'windows-1252');
      const encoding = detectEncoding(buffer);
      expect(['windows-1252', 'ISO-8859-1']).toContain(encoding);
    });

    it('should detect ASCII', () => {
      const buffer = Buffer.from('Plain ASCII text without special characters');
      const encoding = detectEncoding(buffer);
      expect(encoding).toBe('ASCII');
    });

    it('should detect Mac Roman when 0x8E byte is present', () => {
      // Create buffer with Mac Roman specific byte (0x8E = é)
      const buffer = Buffer.from([0x63, 0x61, 0x66, 0x8E]); // "café" in Mac Roman
      const encoding = detectEncoding(buffer);
      expect(encoding).toBe('macintosh');
    });
  });

  describe('decodeBuffer', () => {
    it('should decode UTF-8 correctly', () => {
      const text = 'Hello world: café, naïve, €100, 日本語';
      const buffer = Buffer.from(text);
      const decoded = decodeBuffer(buffer);
      expect(decoded).toBe(text);
    });

    it('should decode ISO-8859-1 correctly', () => {
      const text = 'café naïve £100';
      const buffer = iconv.encode(text, 'ISO-8859-1');
      const decoded = decodeBuffer(buffer);
      expect(decoded).toContain('café');
      expect(decoded).toContain('naïve');
      expect(decoded).toContain('£100');
    });

    it('should decode UTF-16LE correctly', () => {
      const text = 'UTF-16LE text: café, 日本語';
      const buffer = Buffer.concat([
        Buffer.from([0xFF, 0xFE]), // BOM
        iconv.encode(text, 'utf16le')
      ]);
      const decoded = decodeBuffer(buffer);
      expect(decoded).toContain('UTF-16LE text');
      expect(decoded).toContain('café');
      expect(decoded).toContain('日本語');
    });

    it('should use provided encoding when specified', () => {
      const text = 'Test text';
      const buffer = iconv.encode(text, 'windows-1252');
      const decoded = decodeBuffer(buffer, 'windows-1252');
      expect(decoded).toBe(text);
    });

    it('should fallback to UTF-8 for unknown encodings', () => {
      const text = 'Simple text';
      const buffer = Buffer.from(text);
      const decoded = decodeBuffer(buffer, 'unknown-encoding');
      expect(decoded).toBe(text);
    });

    it('should handle empty buffers', () => {
      const buffer = Buffer.from('');
      const decoded = decodeBuffer(buffer);
      expect(decoded).toBe('');
    });
  });

  describe('Logging', () => {
    it('should log filename when provided', () => {
      const loggerSpy = vi.spyOn(logger, 'log');
      const buffer = Buffer.from('test');

      detectEncoding(buffer, 'test.txt');

      expect(loggerSpy).toHaveBeenCalledWith('ENCODING', expect.stringContaining('File: test.txt'));
      loggerSpy.mockRestore();
    });

    it('should not log when filename not provided', () => {
      const loggerSpy = vi.spyOn(logger, 'log');
      const buffer = Buffer.from('test');

      detectEncoding(buffer);

      // Should not log file info when no filename provided
      expect(loggerSpy).not.toHaveBeenCalledWith('ENCODING', expect.stringContaining('File:'));
      loggerSpy.mockRestore();
    });
  });
});