/**
 * Integration test for OCR Pipeline
 * Tests the complete OCR flow with Node.js native implementation
 */

import { describe, it, expect } from 'vitest';
import { extractTextWithOCR, isScannedPDF } from '../../src/main/ocr';
import path from 'path';

describe('OCR Pipeline Integration (Node.js Native)', () => {
  const testPdfPath = path.join(__dirname, '../fixtures/scanned-sample.pdf');

  it('should extract text from PDF using OCR', async () => {
    console.log('Testing OCR extraction with:', testPdfPath);

    // Call the Node.js native OCR
    const result = await extractTextWithOCR(testPdfPath, {
      recognition_level: 'accurate',
      dpi: 200
    });

    console.log('OCR result:', {
      textLength: result.text.length,
      confidence: result.confidence,
      pageCount: result.pages.length,
      hasText: result.text.length > 0
    });

    // Verify the result structure
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.pages).toBeDefined();
    expect(Array.isArray(result.pages)).toBe(true);
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.confidence).toBeDefined();
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  }, 30000); // 30s timeout for OCR processing

  it('should extract expected text content from test PDF', async () => {
    console.log('Testing OCR text content accuracy...');

    const result = await extractTextWithOCR(testPdfPath, {
      recognition_level: 'accurate'
    });

    // The test PDF contains specific text we can verify
    const extractedText = result.text.toLowerCase();

    console.log('Extracted text:', result.text);

    // Verify that key phrases from the test PDF are present
    expect(extractedText).toContain('test document');
    expect(extractedText).toContain('ocr');
    expect(extractedText).toContain('second line');
    expect(extractedText).toContain('12345');
  }, 30000);

  it('should use fast recognition level when requested', async () => {
    console.log('Testing OCR with fast recognition level...');

    const result = await extractTextWithOCR(testPdfPath, {
      recognition_level: 'fast'
    });

    // Verify it still works with fast mode
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.confidence).toBeDefined();
    expect(typeof result.confidence).toBe('number');
  }, 30000);

  it('should handle OCR with custom language preference', async () => {
    console.log('Testing OCR with custom language...');

    const result = await extractTextWithOCR(testPdfPath, {
      recognition_level: 'accurate',
      language: 'fr-FR' // French language
    });

    // Should still extract text, even if language doesn't match content
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(result.confidence).toBeDefined();
  }, 30000);

  it('should detect scanned PDFs correctly', async () => {
    console.log('Testing scanned PDF detection...');

    const isScanned = await isScannedPDF(testPdfPath);

    console.log('Is scanned:', isScanned);

    // The test file is a scanned PDF
    expect(isScanned).toBe(true);
  }, 10000);

  it('should handle errors gracefully for non-existent files', async () => {
    console.log('Testing error handling for non-existent file...');

    const nonExistentPath = '/path/to/nonexistent/file.pdf';

    // Should throw an error
    await expect(
      extractTextWithOCR(nonExistentPath)
    ).rejects.toThrow();
  }, 10000);
});
