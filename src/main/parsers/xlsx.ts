import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { logger } from '../../shared/utils/logger';

// Parser version - increment when parser logic changes
export const XLSX_PARSER_VERSION = 1;

export async function parseXLSX(filePath: string): Promise<string> {
  try {
    // Read the file as a buffer
    const buffer = fs.readFileSync(filePath);
    
    // Parse the workbook
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    // Extract text from all sheets
    const textParts: string[] = [];
    
    // Process each sheet
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      
      // Add sheet name as context
      textParts.push(`Sheet: ${sheetName}`);
      textParts.push(''); // Empty line for separation
      
      // Convert sheet to CSV format for text extraction
      // This preserves the tabular structure which can be helpful for search
      const csvContent = XLSX.utils.sheet_to_csv(worksheet, {
        blankrows: false, // Skip blank rows
        skipHidden: true, // Skip hidden rows/columns
        strip: true // Strip whitespace
      });
      
      if (csvContent.trim()) {
        textParts.push(csvContent);
        textParts.push(''); // Empty line between sheets
      }
    }
    
    // Join all text parts
    const fullText = textParts.join('\n').trim();
    
    // Return empty string if no content found
    if (!fullText) {
      logger.log('INDEXING', `XLSX parser - no content in ${filePath}`);
      return '';
    }

    logger.log('INDEXING', `XLSX parser - ${filePath}: ${fullText.length} characters`);
    return fullText;
    
  } catch (error) {
    console.error(`Failed to parse XLSX file ${filePath}:`, error);
    return '';
  }
}

// XLS uses the same parser as XLSX (the xlsx library handles both)
export const parseXLS = parseXLSX;

// Export parser version for XLS as well
export const XLS_PARSER_VERSION = XLSX_PARSER_VERSION;