import fs from 'fs';
import path from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from 'canvas';
import { logger } from '../../shared/utils/logger';

export interface PDFRenderOptions {
  /**
   * DPI for rendering
   * - 150: Faster, lower quality
   * - 200: Balanced (default)
   * - 300: Slower, higher quality
   */
  dpi?: number;

  /**
   * Specific pages to render (1-indexed)
   * If not provided, renders all pages
   */
  pages?: number[];
}

export interface RenderedPage {
  pageNumber: number;
  imageBuffer: Buffer;
  width: number;
  height: number;
}

/**
 * Renders PDF pages to PNG image buffers
 * Uses pdf.js (bundled with Electron) for rendering
 *
 * @param pdfPath Absolute path to PDF file
 * @param options Rendering options
 * @returns Array of rendered page buffers
 */
export async function renderPDFToImages(
  pdfPath: string,
  options: PDFRenderOptions = {}
): Promise<RenderedPage[]> {
  const dpi = options.dpi ?? 200;

  logger.info('OCR', `Rendering PDF to images: ${path.basename(pdfPath)} at ${dpi} DPI`);

  // Load the PDF
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    // Standard fonts path - adjust for Electron's resources location
    standardFontDataUrl: path.join(__dirname, '../../../node_modules/pdfjs-dist/standard_fonts/')
  });

  const pdfDocument = await loadingTask.promise;
  const totalPages = pdfDocument.numPages;

  logger.info('OCR', `PDF has ${totalPages} pages`);

  // Determine which pages to render
  const pagesToRender = options.pages ?? Array.from({ length: totalPages }, (_, i) => i + 1);

  // Validate page numbers
  const invalidPages = pagesToRender.filter(p => p < 1 || p > totalPages);
  if (invalidPages.length > 0) {
    throw new Error(`Invalid page numbers: ${invalidPages.join(', ')} (PDF has ${totalPages} pages)`);
  }

  const renderedPages: RenderedPage[] = [];

  for (const pageNum of pagesToRender) {
    try {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale: dpi / 72 });

      // Create canvas directly (same pattern as test script)
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');

      // Render the page
      await page.render({
        canvasContext: context as any, // Type assertion: node-canvas types don't perfectly match pdf.js
        viewport: viewport,
        canvas: canvas as any // Required by RenderParameters
      } as any).promise;

      // Convert to PNG buffer
      const imageBuffer = canvas.toBuffer('image/png');

      renderedPages.push({
        pageNumber: pageNum,
        imageBuffer,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height)
      });

      logger.info('OCR', `  Page ${pageNum}: ${Math.round(viewport.width)}x${Math.round(viewport.height)}px, ${(imageBuffer.length / 1024).toFixed(1)} KB`);
    } catch (error: any) {
      logger.error('OCR', `Failed to render page ${pageNum}: ${error.message}`);
      throw new Error(`Failed to render page ${pageNum}: ${error.message}`);
    }
  }

  await pdfDocument.destroy();

  logger.info('OCR', `Rendered ${renderedPages.length} pages successfully`);

  return renderedPages;
}

/**
 * Renders a single PDF page to an image buffer
 * Convenience wrapper around renderPDFToImages
 */
export async function renderPDFPageToImage(
  pdfPath: string,
  pageNumber: number,
  dpi: number = 200
): Promise<Buffer> {
  const results = await renderPDFToImages(pdfPath, { dpi, pages: [pageNumber] });

  if (results.length === 0) {
    throw new Error(`Failed to render page ${pageNumber}`);
  }

  return results[0].imageBuffer;
}
