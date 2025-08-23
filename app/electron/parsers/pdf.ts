import * as fs from 'fs';
const pdfParse = require('pdf-parse');

export interface PDFPage {
  page: number;
  text: string;
}

export async function parsePdf(filePath: string): Promise<PDFPage[]> {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    
    // pdf-parse returns all text combined, so we'll treat it as a single page
    // Clean up and normalize the text
    const text = data.text
      .replace(/\s+/g, ' ')
      .trim();
    
    if (text) {
      // For compatibility, return as a single page
      return [{ page: 1, text: text.substring(0, 50000) }]; // Limit to ~50k chars
    }
    
    return [];
  } catch (error) {
    console.error(`Failed to parse PDF ${filePath}:`, error);
    return [];
  }
}