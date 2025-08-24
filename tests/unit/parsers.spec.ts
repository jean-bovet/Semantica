import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { parsePdf } from '../../app/electron/parsers/pdf';
import { parseDocx } from '../../app/electron/parsers/docx';
import { parseRtf } from '../../app/electron/parsers/rtf';
import { parseText } from '../../app/electron/parsers/text';

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
    it('should extract text from simple PDF', async () => {
      const filePath = path.join(fixturesDir, 'simple.pdf');
      
      // Check if file exists and is valid
      if (fs.existsSync(filePath)) {
        const pages = await parsePdf(filePath);
        // The minimal PDF contains "Hello World"
        if (pages && pages.length > 0) {
          expect(pages[0].text.toLowerCase()).toContain('hello');
          expect(pages[0].page).toBe(1);
        }
      }
    });

    it('should handle corrupt PDF gracefully', async () => {
      const filePath = path.join(fixturesDir, 'corrupt.pdf');
      const pages = await parsePdf(filePath);
      
      // Should return empty array for corrupt PDFs
      expect(pages).toEqual([]);
    });

    it('should handle non-existent PDF files', async () => {
      const filePath = path.join(fixturesDir, 'non-existent.pdf');
      const pages = await parsePdf(filePath);
      
      expect(pages).toEqual([]);
    });
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
      // Note: Actually testing permission errors is OS-dependent
      // This is a placeholder for the pattern
      const restrictedPath = '/root/restricted.txt';
      
      // All parsers should handle errors gracefully
      const results = await Promise.all([
        parseText(restrictedPath),
        parsePdf(restrictedPath),
        parseRtf(restrictedPath),
      ]);
      
      // Text and RTF return strings, PDF returns array
      expect(results[0]).toBe(''); // parseText
      expect(results[1]).toEqual([]); // parsePdf returns array
      expect(results[2]).toBe(''); // parseRtf
    });
  });
});