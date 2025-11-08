import fs from 'fs';
import path from 'path';
import os from 'os';
import MacOCR from '@cherrystudio/mac-system-ocr';
import { logger } from '../../shared/utils/logger';

export interface OCROptions {
  /**
   * Language preference (e.g., 'en-US', 'fr-FR', 'es-ES')
   * Default: 'en-US'
   */
  language?: string;

  /**
   * Recognition level
   * - 'accurate': Slower, more accurate
   * - 'fast': Faster, less accurate
   * Default: 'accurate'
   */
  recognition_level?: 'accurate' | 'fast';

  /**
   * Progress callback for batch operations
   * Called after each image is processed
   * @param processed Number of images processed so far
   * @param total Total number of images
   */
  onProgress?: (processed: number, total: number) => void;
}

export interface OCRResult {
  text: string;
  confidence: number; // 0-1
}

/**
 * Performs OCR on an image buffer using macOS Vision framework
 * @param imageBuffer PNG image buffer
 * @param options OCR options
 * @returns Extracted text and confidence score
 */
export async function ocrImage(
  imageBuffer: Buffer,
  options: OCROptions = {}
): Promise<OCRResult> {
  const language = options.language ?? 'en-US';
  const recognitionLevel = options.recognition_level ?? 'accurate';

  // MacOCR requires a file path, so save temporarily
  const tempDir = os.tmpdir();
  const tempPath = path.join(tempDir, `semantica-ocr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`);

  try {
    // Write image to temp file
    fs.writeFileSync(tempPath, imageBuffer);

    logger.info('OCR', `Running macOS Vision OCR (${language}, ${recognitionLevel})`);

    const startTime = Date.now();

    // Run OCR
    const results = await MacOCR.recognizeFromPath(tempPath);

    const duration = Date.now() - startTime;

    // Extract text from results
    // MacOCR can return different formats:
    // - A string directly
    // - An array of strings
    // - An array of objects with 'text' property
    // - A single object with 'text' property
    let text: string;

    if (typeof results === 'string') {
      text = results;
    } else if (Array.isArray(results)) {
      text = results.map(r => {
        if (typeof r === 'string') return r;
        if (typeof r === 'object' && r !== null && 'text' in r) return r.text;
        // For any other object type, try to extract meaningful text
        if (typeof r === 'object' && r !== null) {
          // Log unexpected format for debugging
          logger.warn('OCR', `Unexpected MacOCR result format: ${JSON.stringify(r).substring(0, 100)}`);
          return String(r.text || r.string || r.value || '');
        }
        return String(r);
      }).join('\n');
    } else if (typeof results === 'object' && results !== null) {
      // Single object result
      text = (results as any).text || (results as any).string || String(results);
    } else {
      text = String(results);
    }

    // Calculate average confidence if available
    // MacOCR results may include confidence scores
    let confidence = 0.95; // Default confidence (Vision framework is typically very accurate)

    if (Array.isArray(results) && results.length > 0) {
      const confidences = results
        .map(r => typeof r === 'object' && r.confidence ? r.confidence : null)
        .filter((c): c is number => c !== null);

      if (confidences.length > 0) {
        confidence = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
      }
    }

    logger.info('OCR', `OCR completed in ${duration}ms: ${text.length} chars, confidence=${(confidence * 100).toFixed(1)}%`);

    return {
      text,
      confidence
    };
  } catch (error: any) {
    logger.error('OCR', `macOS Vision OCR failed: ${error.message}`);
    throw new Error(`OCR failed: ${error.message}`);
  } finally {
    // Clean up temp file
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (cleanupError) {
      logger.warn('OCR', `Failed to clean up temp file ${tempPath}`);
    }
  }
}

/**
 * Performs OCR on multiple images in batch with parallel processing
 *
 * Processes images in batches of 3 concurrently for better performance
 * while avoiding overwhelming the macOS Vision framework.
 *
 * @param imageBuffers Array of PNG image buffers
 * @param options OCR options
 * @returns Array of OCR results (one per image, in order)
 */
export async function ocrImages(
  imageBuffers: Buffer[],
  options: OCROptions = {}
): Promise<OCRResult[]> {
  logger.info('OCR', `Processing ${imageBuffers.length} images with macOS Vision (3 concurrent)`);

  const results: OCRResult[] = new Array(imageBuffers.length);
  const BATCH_SIZE = 3; // Process 3 images concurrently
  let processedCount = 0;

  // Process images in batches
  for (let batchStart = 0; batchStart < imageBuffers.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, imageBuffers.length);
    const batchIndexes = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

    logger.info('OCR', `  Processing batch: images ${batchStart + 1}-${batchEnd}/${imageBuffers.length}`);

    // Process this batch in parallel
    const batchPromises = batchIndexes.map(async (index) => {
      try {
        const result = await ocrImage(imageBuffers[index], options);
        results[index] = result;
        logger.info('OCR', `    Image ${index + 1}: ${result.text.length} chars`);
        return { index, result };
      } catch (error: any) {
        logger.error('OCR', `Failed to OCR image ${index + 1}: ${error.message}`);
        throw new Error(`Failed to OCR image ${index + 1}: ${error.message}`);
      }
    });

    // Wait for batch to complete
    await Promise.all(batchPromises);

    // Update progress after each batch
    processedCount += batchIndexes.length;
    if (options.onProgress) {
      options.onProgress(processedCount, imageBuffers.length);
    }
  }

  return results;
}
