import { promises as fsPromises } from 'fs';
import { logger } from '../../shared/utils/logger';
import type { PythonSidecarClient } from '../worker/PythonSidecarClient';
const pdfParse = require('pdf-parse');

// Parser version - single source of truth (imported by parserVersions.ts)
export const PARSER_VERSION = 3; // Version 3: OCR support for scanned PDFs

export interface PDFPage {
  page: number;
  text: string;
}

export interface PDFParserOptions {
  enableOCR?: boolean;
  sidecarClient?: PythonSidecarClient;
}

export async function parsePdf(
  filePath: string,
  options?: PDFParserOptions
): Promise<PDFPage[]> {
  try {
    const dataBuffer = await fsPromises.readFile(filePath);

    // Check if file is actually a PDF
    const header = dataBuffer.toString('utf8', 0, Math.min(5, dataBuffer.length));
    if (!header.startsWith('%PDF')) {
      logger.warn('INDEXING', `File ${filePath} is not a valid PDF (header: ${header})`);
      throw new Error('Not a valid PDF file');
    }

    // Suppress pdf.js font warnings during parsing (noisy but harmless)
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      // Filter out the specific font warning that floods logs
      const message = args.join(' ');
      if (message.includes('font private use area') ||
          message.includes('Ran out of space')) {
        return; // Ignore this warning
      }
      originalWarn.apply(console, args);
    };

    let data;
    try {
      data = await pdfParse(dataBuffer, {
        // Options to handle more PDF types
        max: 0, // Parse all pages (0 = no limit)
        version: 'v2.0.550' // Use latest pdf.js version
      });
    } finally {
      // Restore original console.warn
      console.warn = originalWarn;
    }

    // Check if we got any text
    const hasText = data?.text && data.text.trim().length > 0;

    // If no text and OCR is enabled, try OCR
    if (!hasText && options?.enableOCR && options?.sidecarClient) {
      logger.info('INDEXING', `PDF ${filePath} has no text, attempting OCR...`);

      try {
        // Check if it's actually scanned
        const detection = await options.sidecarClient.detectScannedPDF(filePath);

        if (detection.is_scanned) {
          logger.info('INDEXING', `Confirmed scanned PDF (${detection.page_count} pages), running OCR...`);

          // Extract text via OCR
          const ocrResult = await options.sidecarClient.extractWithOCR(filePath, {
            recognition_level: 'accurate'
          });

          logger.info('INDEXING', `OCR extracted ${ocrResult.text.length} chars with ${(ocrResult.confidence * 100).toFixed(1)}% confidence`);

          // Convert to PDFPage format
          return ocrResult.pages.map((pageText, i) => ({
            page: i + 1,
            text: pageText
          }));
        } else {
          logger.warn('INDEXING', `PDF ${filePath} not detected as scanned, but has no extractable text`);
          throw new Error('PDF contains no extractable text and does not appear to be scanned');
        }
      } catch (ocrError: any) {
        logger.error('INDEXING', `OCR failed for ${filePath}: ${ocrError.message}`);
        throw new Error(`OCR failed: ${ocrError.message}`);
      }
    }

    if (!hasText) {
      // PDF might be scanned/image-based
      logger.warn('INDEXING', `PDF ${filePath} contains no extractable text (OCR ${options?.enableOCR ? 'failed' : 'disabled'})`);
      throw new Error('PDF contains no extractable text');
    }
    
    // Clean up and normalize the text
    const text = data.text
      .replace(/\s+/g, ' ')
      .trim();
    
    // For compatibility, return as a single page
    // Split very long PDFs into multiple chunks
    const pages: PDFPage[] = [];
    const chunkSize = 50000; // 50k chars per "page"
    
    for (let i = 0; i < text.length; i += chunkSize) {
      pages.push({
        page: Math.floor(i / chunkSize) + 1,
        text: text.substring(i, Math.min(i + chunkSize, text.length))
      });
    }
    
    return pages;
  } catch (error: any) {
    logger.error('INDEXING', `Failed to parse PDF ${filePath}:`, error.message);
    throw error; // Re-throw to be caught by handleFile
  }
}