import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import fs from 'node:fs';
import path from 'node:path';

GlobalWorkerOptions.workerSrc = path.join(
  path.dirname(require.resolve('pdfjs-dist')),
  'build/pdf.worker.js'
);

export interface PDFPage {
  page: number;
  text: string;
}

export async function parsePdf(filePath: string): Promise<PDFPage[]> {
  try {
    const data = new Uint8Array(fs.readFileSync(filePath));
    const pdf = await getDocument({ data }).promise;
    const pages: PDFPage[] = [];
    
    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        const text = textContent.items
          .map((item: any) => item.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        if (text) {
          pages.push({ page: i, text });
        }
      } catch (pageError) {
        console.error(`Failed to parse page ${i} of ${filePath}:`, pageError);
      }
    }
    
    await pdf.cleanup();
    await pdf.destroy();
    
    return pages;
  } catch (error) {
    console.error(`Failed to parse PDF ${filePath}:`, error);
    return [];
  }
}