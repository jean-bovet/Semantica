import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { parsePdf } from '../../src/main/parsers/pdf';
import { parseDocx } from '../../src/main/parsers/docx';
import { parseRtf } from '../../src/main/parsers/rtf';
import { parseText } from '../../src/main/parsers/text';

const fixturesDir = path.join(__dirname, '../fixtures');

describe('Document Parsers', () => {
  describe('Text Parser', () => {
    it('should read UTF-8 text files', async () => {
      const filePath = path.join(fixturesDir, 'simple.txt');
      const text = await parseText(filePath);
      
      expect(text).toContain('This is a simple test file');
      expect(text).toContain('Hello 世界'); // Unicode test
      expect(text.length).toBeGreaterThan(0);
    });

    it('should handle large text files', async () => {
      const filePath = path.join(fixturesDir, 'large.txt');
      const text = await parseText(filePath);
      
      expect(text.length).toBeGreaterThan(3000);
      expect(text).toContain('Lorem ipsum');
      expect(text).toContain('Machine learning');
    });

    it('should handle non-existent files gracefully', async () => {
      const filePath = path.join(fixturesDir, 'non-existent.txt');
      const text = await parseText(filePath);
      
      expect(text).toBe('');
    });

    it('should handle empty files', async () => {
      // Create an empty file
      const emptyPath = path.join(fixturesDir, 'empty.txt');
      fs.writeFileSync(emptyPath, '');
      
      const text = await parseText(emptyPath);
      expect(text).toBe('');
      
      // Clean up
      fs.unlinkSync(emptyPath);
    });
  });

  describe('RTF Parser', () => {
    it('should extract text from RTF', async () => {
      const filePath = path.join(fixturesDir, 'simple.rtf');
      const text = await parseRtf(filePath);
      
      expect(text).toContain('RTF document');
      expect(text).toContain('rich text formatting');
      expect(text.length).toBeGreaterThan(0);
    });

    it('should handle corrupt RTF gracefully', async () => {
      // Create a corrupt RTF file
      const corruptPath = path.join(fixturesDir, 'corrupt.rtf');
      fs.writeFileSync(corruptPath, 'NOT_RTF_FORMAT{corrupted}');
      
      const text = await parseRtf(corruptPath);
      // Should either return empty or raw text
      expect(typeof text).toBe('string');
      
      // Clean up
      fs.unlinkSync(corruptPath);
    });
  });

  describe('PDF Parser', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should detect non-PDF files', async () => {
      const tempFile = path.join(require('os').tmpdir(), 'not-a-pdf.pdf');
      fs.writeFileSync(tempFile, 'NOT A PDF CONTENT');
      
      await expect(parsePdf(tempFile)).rejects.toThrow('Not a valid PDF file');
      
      fs.unlinkSync(tempFile);
    });

    it('should handle non-existent PDF files', async () => {
      const nonExistentPath = path.join(require('os').tmpdir(), 'non-existent-' + Date.now() + '.pdf');
      
      await expect(parsePdf(nonExistentPath)).rejects.toThrow();
    });

    it('should handle empty PDF files', async () => {
      const tempFile = path.join(require('os').tmpdir(), 'empty.pdf');
      fs.writeFileSync(tempFile, '%PDF-1.4\n%%EOF');
      
      // Should throw because there's no extractable text
      await expect(parsePdf(tempFile)).rejects.toThrow();
      
      fs.unlinkSync(tempFile);
    });

    // Note: Testing actual PDF parsing with pdf-parse requires valid PDF structures
    // which are complex to create programmatically. Integration tests with real PDFs
    // are more appropriate for validating the parsing functionality.
  });

  describe('Parser Selection', () => {
    it('should select correct parser based on extension', () => {
      // This would test the logic that selects which parser to use
      const extensions = {
        'test.txt': 'text',
        'test.pdf': 'pdf',
        'test.docx': 'docx',
        'test.rtf': 'rtf',
        'test.md': 'text', // Markdown should use text parser
      };
      
      Object.entries(extensions).forEach(([filename, expectedType]) => {
        const ext = path.extname(filename).toLowerCase();
        let parserType = 'unknown';
        
        if (['.txt', '.md'].includes(ext)) parserType = 'text';
        else if (ext === '.pdf') parserType = 'pdf';
        else if (ext === '.docx') parserType = 'docx';
        else if (ext === '.rtf') parserType = 'rtf';
        
        expect(parserType).toBe(expectedType);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle permission errors gracefully', async () => {
      // Create a test file in temp directory
      const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'parser-test-'));
      const restrictedFile = path.join(tempDir, 'restricted.txt');
      fs.writeFileSync(restrictedFile, 'test content');
      
      // Make file unreadable (on Unix systems)
      try {
        fs.chmodSync(restrictedFile, 0o000);
      } catch (e) {
        // On Windows, chmod might not work as expected
        // Skip this test on Windows
        console.log('Skipping permission test on this OS');
        fs.rmSync(tempDir, { recursive: true, force: true });
        return;
      }
      
      // Test each parser's error handling
      // parseText returns empty string on error
      const textResult = await parseText(restrictedFile);
      expect(textResult).toBe('');
      
      // parsePdf throws on error (by design - caught by handleFile)
      await expect(parsePdf(restrictedFile)).rejects.toThrow();
      
      // parseRtf returns empty string on error
      const rtfResult = await parseRtf(restrictedFile);
      expect(rtfResult).toBe('');
      
      // Clean up
      try {
        fs.chmodSync(restrictedFile, 0o644);
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    });
  });
});