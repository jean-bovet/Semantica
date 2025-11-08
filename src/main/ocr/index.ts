import { renderPDFToImages } from './pdfToImage';
import { ocrImages, OCROptions } from './visionOCR';
import { logger } from '../../shared/utils/logger';

export interface PDFOCROptions extends OCROptions {
  /**
   * DPI for PDF rendering
   * Default: 200
   */
  dpi?: number;

  /**
   * Specific pages to process (1-indexed)
   * If not provided, processes all pages
   */
  pages?: number[];
}

export interface PDFOCRResult {
  /**
   * Full text from all pages concatenated
   */
  text: string;

  /**
   * Text from each page
   */
  pages: string[];

  /**
   * Average confidence score across all pages (0-1)
   */
  confidence: number;
}

/**
 * Extracts text from a scanned PDF using OCR
 *
 * This is a Node.js native OCR implementation using:
 * - pdf.js for PDF rendering (no Poppler dependency)
 * - macOS Vision framework for OCR (via @cherrystudio/mac-system-ocr)
 *
 * @param pdfPath Absolute path to the PDF file
 * @param options OCR and rendering options
 * @returns Extracted text with confidence scores
 *
 * @throws Error if PDF cannot be rendered or OCR fails
 *
 * @example
 * ```ts
 * const result = await extractTextWithOCR('/path/to/scanned.pdf', {
 *   dpi: 200,
 *   language: 'en-US',
 *   recognition_level: 'accurate'
 * });
 *
 * console.log(`Extracted ${result.text.length} characters`);
 * console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
 * ```
 */
export async function extractTextWithOCR(
  pdfPath: string,
  options: PDFOCROptions = {}
): Promise<PDFOCRResult> {
  const dpi = options.dpi ?? 200;

  logger.info('OCR', `Starting OCR extraction for PDF: ${pdfPath}`);

  try {
    // Step 1: Render PDF pages to images
    const renderedPages = await renderPDFToImages(pdfPath, { dpi, pages: options.pages });

    if (renderedPages.length === 0) {
      throw new Error('No pages were rendered from PDF');
    }

    logger.info('OCR', `Rendered ${renderedPages.length} pages, starting OCR...`);

    // Step 2: Perform OCR on all images
    const imageBuffers = renderedPages.map(p => p.imageBuffer);
    const ocrResults = await ocrImages(imageBuffers, {
      language: options.language,
      recognition_level: options.recognition_level,
      onProgress: options.onProgress
    });

    // Step 3: Combine results
    const pagesText = ocrResults.map(r => r.text);
    const fullText = pagesText.join('\n\n'); // Separate pages with double newline
    const avgConfidence = ocrResults.reduce((sum, r) => sum + r.confidence, 0) / ocrResults.length;

    logger.info('OCR', `OCR complete: ${fullText.length} chars, avg confidence=${(avgConfidence * 100).toFixed(1)}%`);

    return {
      text: fullText,
      pages: pagesText,
      confidence: avgConfidence
    };
  } catch (error: any) {
    logger.error('OCR', `OCR extraction failed: ${error.message}`);
    throw new Error(`OCR extraction failed: ${error.message}`);
  }
}

/**
 * Detects if a PDF is scanned by checking text density
 *
 * Uses pdf-parse to extract text and checks if there's enough
 * extractable text. If not, the PDF is likely scanned.
 *
 * @param pdfPath Absolute path to the PDF file
 * @returns True if PDF appears to be scanned (needs OCR)
 */
export async function isScannedPDF(pdfPath: string): Promise<boolean> {
  try {
    const fs = await import('fs/promises');
    const pdfParse = require('pdf-parse');

    const dataBuffer = await fs.readFile(pdfPath);
    const data = await pdfParse(dataBuffer, { max: 0 });

    // Calculate average characters per page
    const pageCount = data.numpages || 1;
    const totalChars = data.text?.length || 0;
    const avgCharsPerPage = totalChars / pageCount;

    // Threshold: Less than 50 chars/page likely means scanned
    const isScanned = avgCharsPerPage < 50;

    logger.info('OCR', `PDF scan detection: ${avgCharsPerPage.toFixed(1)} chars/page → ${isScanned ? 'SCANNED' : 'DIGITAL'}`);

    return isScanned;
  } catch (error: any) {
    logger.error('OCR', `Scan detection failed: ${error.message}`);
    // If we can't detect, assume it might need OCR
    return true;
  }
}

// Re-export types for convenience
export type { OCROptions } from './visionOCR';
export { renderPDFToImages, renderPDFPageToImage } from './pdfToImage';
export { ocrImage, ocrImages } from './visionOCR';
