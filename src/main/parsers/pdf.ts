import * as fs from 'fs';
const pdfParse = require('pdf-parse');

export const PARSER_VERSION = 1; // Version 1: Initial pdf-parse implementation

export interface PDFPage {
  page: number;
  text: string;
}

export async function parsePdf(filePath: string): Promise<PDFPage[]> {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    
    // Check if file is actually a PDF
    const header = dataBuffer.toString('utf8', 0, Math.min(5, dataBuffer.length));
    if (!header.startsWith('%PDF')) {
      console.warn(`File ${filePath} is not a valid PDF (header: ${header})`);
      throw new Error('Not a valid PDF file');
    }
    
    const data = await pdfParse(dataBuffer, {
      // Options to handle more PDF types
      max: 0, // Parse all pages (0 = no limit)
      version: 'v2.0.550' // Use latest pdf.js version
    });
    
    // Check if we got any text
    if (!data.text || data.text.trim().length === 0) {
      // PDF might be scanned/image-based
      console.warn(`PDF ${filePath} contains no extractable text (might be scanned/image-based)`);
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
    console.error(`Failed to parse PDF ${filePath}:`, error.message);
    throw error; // Re-throw to be caught by handleFile
  }
}