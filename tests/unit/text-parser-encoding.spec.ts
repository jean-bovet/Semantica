import { describe, it, expect, beforeAll } from 'vitest';
import { parseText } from '../../src/main/parsers/text';
import * as path from 'path';
import * as fs from 'fs';
import iconv from 'iconv-lite';

describe('Text Parser - Encoding Detection', () => {
  const fixturesDir = path.join(__dirname, '../fixtures/encodings');
  
  beforeAll(() => {
    // Ensure test files exist
    const testFiles = [
      'utf8.txt',
      'iso-8859-1.txt', 
      'windows-1252.txt',
      'utf16le.txt',
      'ascii.txt',
      'macroman.txt',
      'pascal-iso-8859-1.txt'
    ];
    
    for (const file of testFiles) {
      const filepath = path.join(fixturesDir, file);
      if (!fs.existsSync(filepath)) {
        throw new Error(`Test file missing: ${filepath}. Run node tests/fixtures/encodings/create-test-files.js first`);
      }
    }
  });

  describe('UTF-8 encoding', () => {
    it('should correctly parse UTF-8 text with special characters', async () => {
      const filepath = path.join(fixturesDir, 'utf8.txt');
      const result = await parseText(filepath);
      
      expect(result).toContain('café');
      expect(result).toContain('naïve');
      expect(result).toContain('€100');
      expect(result).toContain('日本語');
    });
  });

  describe('ISO-8859-1 (Latin-1) encoding', () => {
    it('should correctly parse ISO-8859-1 text', async () => {
      const filepath = path.join(fixturesDir, 'iso-8859-1.txt');
      const result = await parseText(filepath);
      
      expect(result).toContain('café');
      expect(result).toContain('naïve');
      expect(result).toContain('£100');
      expect(result).toContain('©2024');
      expect(result).toContain('ISO-8859-1');
    });

    it('should correctly parse Pascal code in ISO-8859-1', async () => {
      const filepath = path.join(fixturesDir, 'pascal-iso-8859-1.txt');
      const result = await parseText(filepath);
      
      expect(result).toContain('copyright 1983, 1984');
      expect(result).toContain('TestProcedure');
      expect(result).toContain('résultat');
      expect(result).toContain('größe');
      expect(result).toContain('café');
      expect(result).toContain('naïve');
    });
  });

  describe('Windows-1252 encoding', () => {
    it('should correctly parse Windows-1252 text with smart quotes', async () => {
      const filepath = path.join(fixturesDir, 'windows-1252.txt');
      const result = await parseText(filepath);
      
      expect(result).toContain('Windows-1252');
      expect(result).toContain('smart quotes');
      expect(result).toContain('€uro');
      expect(result).toContain('café');
    });
  });

  describe('UTF-16LE encoding', () => {
    it('should correctly parse UTF-16LE text', async () => {
      const filepath = path.join(fixturesDir, 'utf16le.txt');
      const result = await parseText(filepath);
      
      expect(result).toContain('UTF-16LE');
      expect(result).toContain('café');
      expect(result).toContain('日本語');
      // Note: emoji might not be preserved in all cases
    });
  });

  describe('ASCII encoding', () => {
    it('should correctly parse plain ASCII text', async () => {
      const filepath = path.join(fixturesDir, 'ascii.txt');
      const result = await parseText(filepath);
      
      expect(result).toContain('plain ASCII text');
      expect(result).toContain('without special characters');
    });
  });

  describe('Mac Roman encoding', () => {
    it('should correctly parse Mac Roman text', async () => {
      const filepath = path.join(fixturesDir, 'macroman.txt');
      const result = await parseText(filepath);
      
      expect(result).toContain('Mac Roman');
      expect(result).toContain('café');
      expect(result).toContain('bullet');
      expect(result).toContain('symbol');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty files gracefully', async () => {
      // Create an empty file
      const emptyFile = path.join(fixturesDir, 'empty.txt');
      fs.writeFileSync(emptyFile, '');
      
      const result = await parseText(emptyFile);
      expect(result).toBe('');
      
      // Clean up
      fs.unlinkSync(emptyFile);
    });

    it('should handle files with only whitespace', async () => {
      const whitespaceFile = path.join(fixturesDir, 'whitespace.txt');
      fs.writeFileSync(whitespaceFile, '   \n\t\r\n   ');
      
      const result = await parseText(whitespaceFile);
      expect(result).toBe('');
      
      // Clean up
      fs.unlinkSync(whitespaceFile);
    });

    it('should return empty string for non-existent files', async () => {
      const nonExistentFile = path.join(fixturesDir, 'does-not-exist.txt');
      const result = await parseText(nonExistentFile);
      expect(result).toBe('');
    });
  });

  describe('Markdown processing', () => {
    it('should strip markdown formatting from .md files', async () => {
      const mdFile = path.join(fixturesDir, 'test.md');
      const mdContent = `# Header 1
      
## Header 2

This is **bold** and this is *italic*.

- List item 1
- List item 2

1. Numbered item
2. Another item

> Quote text

[Link text](https://example.com)

\`\`\`code block\`\`\``;

      fs.writeFileSync(mdFile, mdContent);
      
      const result = await parseText(mdFile);
      
      // Headers should be stripped
      expect(result).not.toContain('#');
      // Bold/italic markers should be stripped
      expect(result).not.toContain('**');
      expect(result).not.toContain('*italic*');
      // List markers should be stripped
      expect(result).not.toMatch(/^-\s+/);
      expect(result).not.toMatch(/^\d+\.\s+/);
      // Quote markers should be stripped
      expect(result).not.toMatch(/^>\s+/);
      // Links should show text only
      expect(result).toContain('Link text');
      expect(result).not.toContain('https://example.com');
      // Code blocks should be stripped
      expect(result).not.toContain('```');
      
      // Content should still be present
      expect(result).toContain('Header');
      expect(result).toContain('bold');
      expect(result).toContain('italic');
      expect(result).toContain('List item');
      expect(result).toContain('Quote text');
      
      // Clean up
      fs.unlinkSync(mdFile);
    });

    it('should handle markdown files with different encodings', async () => {
      const mdFile = path.join(fixturesDir, 'encoded.md');
      const mdContent = '# Café and naïve text\n\nThis has **special** characters: €100';
      
      // Write as ISO-8859-1
      fs.writeFileSync(mdFile, iconv.encode(mdContent, 'ISO-8859-1'));
      
      const result = await parseText(mdFile);
      
      expect(result).toContain('Café');
      expect(result).toContain('naïve');
      expect(result).not.toContain('#');
      expect(result).not.toContain('**');
      
      // Clean up
      fs.unlinkSync(mdFile);
    });
  });

  describe('Performance and memory', () => {
    it('should handle large files efficiently', async () => {
      const largeFile = path.join(fixturesDir, 'large.txt');
      
      // Create a 1MB file with repeated text
      const chunk = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(100);
      const largeContent = chunk.repeat(200); // ~1MB
      fs.writeFileSync(largeFile, largeContent);
      
      const startTime = Date.now();
      const result = await parseText(largeFile);
      const endTime = Date.now();
      
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
      // Should process within reasonable time (< 2 seconds for 1MB)
      expect(endTime - startTime).toBeLessThan(2000);
      
      // Clean up
      fs.unlinkSync(largeFile);
    });
  });

  describe('Regression tests', () => {
    it('should not show garbled characters for Western ASCII encoded files', async () => {
      // This is the specific issue the user reported
      const testFile = path.join(fixturesDir, 'western-ascii.txt');
      
      // Create a file that mimics the user's Lisa Pascal source files
      const pascalContent = `(*********************************************************************************)\n(*  FLUSHFS:  request to flush file system info                                 *)\n(*********************************************************************************)\n\nprocedure flushfs (* var ecode:error *);\nlabel  1;\nvar\n  page   : longint;\n  actual : longint;\nbegin\n  writeln ('FLUSHFS:  exiting with ecode of ',ecode);\nend;`;
      
      // Write as ISO-8859-1 (Western ASCII)
      fs.writeFileSync(testFile, iconv.encode(pascalContent, 'ISO-8859-1'));
      
      const result = await parseText(testFile);
      
      // Should not contain replacement character (�)
      expect(result).not.toContain('\uFFFD');
      expect(result).not.toContain('�');
      
      // Should contain the actual content
      expect(result).toContain('FLUSHFS');
      expect(result).toContain('procedure');
      expect(result).toContain('ecode:error');
      
      // Clean up
      fs.unlinkSync(testFile);
    });
  });
});