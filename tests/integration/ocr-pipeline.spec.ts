/**
 * Integration test for OCR Pipeline
 * Tests the complete OCR flow with the real Python sidecar
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PythonSidecarService } from '../../src/main/worker/PythonSidecarService';
import { PythonSidecarClient } from '../../src/main/worker/PythonSidecarClient';
import path from 'path';

describe('OCR Pipeline Integration (Real Sidecar)', () => {
  let sidecarService: PythonSidecarService;
  let sidecarClient: PythonSidecarClient;
  const testPdfPath = path.join(__dirname, '../fixtures/scanned-sample.pdf');

  beforeAll(async () => {
    console.log('Starting Python sidecar for OCR testing...');

    // Create sidecar client and service
    sidecarClient = new PythonSidecarClient({ port: 8421 });
    sidecarService = new PythonSidecarService({
      client: sidecarClient,
      port: 8421,
      autoRestart: false
    });

    // Start the sidecar
    const started = await sidecarService.startSidecar();
    expect(started).toBe(true);

    console.log('Python sidecar initialized successfully');
  }, 60000); // 60s timeout for startup

  afterAll(async () => {
    console.log('Stopping Python sidecar...');
    if (sidecarService) {
      await sidecarService.stopSidecar();
    }
  });

  it('should extract text from PDF using OCR', async () => {
    console.log('Testing OCR extraction with:', testPdfPath);

    // Call the OCR extraction endpoint
    const result = await sidecarClient.extractWithOCR(testPdfPath, {
      recognition_level: 'accurate'
    });

    console.log('OCR result:', {
      textLength: result.text.length,
      confidence: result.confidence,
      hasText: result.text.length > 0
    });

    // Verify the result structure
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.confidence).toBeDefined();
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  }, 30000); // 30s timeout for OCR processing

  it('should extract expected text content from test PDF', async () => {
    console.log('Testing OCR text content accuracy...');

    const result = await sidecarClient.extractWithOCR(testPdfPath, {
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

    const result = await sidecarClient.extractWithOCR(testPdfPath, {
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

    const result = await sidecarClient.extractWithOCR(testPdfPath, {
      recognition_level: 'accurate',
      language: 'fr-FR' // French language
    });

    // Should still extract text, even if language doesn't match content
    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(result.confidence).toBeDefined();
  }, 30000);

  it('should handle errors gracefully for non-existent files', async () => {
    console.log('Testing error handling for non-existent file...');

    const nonExistentPath = '/path/to/nonexistent/file.pdf';

    // Should throw an error
    await expect(
      sidecarClient.extractWithOCR(nonExistentPath)
    ).rejects.toThrow();
  }, 10000);
});
