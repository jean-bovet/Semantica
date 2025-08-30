import * as fs from 'fs/promises';
import { parse } from 'csv-parse';
import { detectEncoding } from '../utils/encoding-detector';

// Parser version - increment when parser logic changes
export const CSV_PARSER_VERSION = 1;

export async function parseCSV(filePath: string): Promise<string> {
  try {
    // Read file with encoding detection (CSV files can have various encodings)
    const buffer = await fs.readFile(filePath);
    const encoding = detectEncoding(buffer, filePath);
    
    // Convert buffer to string with detected encoding
    let content: string;
    if (encoding === 'UTF-8' || encoding === 'ASCII') {
      content = buffer.toString('utf-8');
    } else if (encoding === 'utf16le') {
      content = buffer.toString('utf16le');
    } else {
      // For other encodings, use iconv-lite
      const iconv = await import('iconv-lite');
      content = iconv.decode(buffer, encoding || 'utf-8');
    }
    
    // Parse CSV content
    return new Promise((resolve, reject) => {
      const output: string[] = [];
      
      // Create parser with options
      const parser = parse({
        delimiter: ',', // Will auto-detect if different
        relax_quotes: true, // Be lenient with quotes
        skip_empty_lines: true, // Skip empty lines
        trim: true, // Trim whitespace from fields
        relax_column_count: true, // Allow variable column counts
        skip_records_with_error: true // Skip problematic rows instead of failing
      });
      
      // Handle parsed data
      parser.on('readable', function() {
        let record;
        while ((record = parser.read()) !== null) {
          // Join fields with spaces for better searchability
          // This preserves the data while making it searchable
          output.push(record.join(' '));
        }
      });
      
      // Handle errors
      parser.on('error', function(err) {
        console.error(`CSV parse error in ${filePath}:`, err.message);
        // Don't reject, just log and continue with what we have
      });
      
      // Handle completion
      parser.on('end', function() {
        const fullText = output.join('\n').trim();
        
        if (!fullText) {
          console.log(`[CSV PARSER] No text content found in: ${filePath}`);
          resolve('');
        } else {
          console.log(`[CSV PARSER] Successfully parsed: ${filePath} (${fullText.length} characters, ${output.length} rows)`);
          resolve(fullText);
        }
      });
      
      // Write the content to the parser
      parser.write(content);
      parser.end();
    });
    
  } catch (error) {
    console.error(`Failed to parse CSV file ${filePath}:`, error);
    return '';
  }
}

// TSV (Tab-separated values) parser - reuse CSV parser with different delimiter
export async function parseTSV(filePath: string): Promise<string> {
  try {
    // Read file with encoding detection
    const buffer = await fs.readFile(filePath);
    const encoding = detectEncoding(buffer, filePath);
    
    // Convert buffer to string with detected encoding
    let content: string;
    if (encoding === 'UTF-8' || encoding === 'ASCII') {
      content = buffer.toString('utf-8');
    } else if (encoding === 'utf16le') {
      content = buffer.toString('utf16le');
    } else {
      const iconv = await import('iconv-lite');
      content = iconv.decode(buffer, encoding || 'utf-8');
    }
    
    // Parse TSV content (tab delimiter)
    return new Promise((resolve, reject) => {
      const output: string[] = [];
      
      const parser = parse({
        delimiter: '\t', // Tab delimiter for TSV
        relax_quotes: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        skip_records_with_error: true
      });
      
      parser.on('readable', function() {
        let record;
        while ((record = parser.read()) !== null) {
          output.push(record.join(' '));
        }
      });
      
      parser.on('error', function(err) {
        console.error(`TSV parse error in ${filePath}:`, err.message);
      });
      
      parser.on('end', function() {
        const fullText = output.join('\n').trim();
        
        if (!fullText) {
          console.log(`[TSV PARSER] No text content found in: ${filePath}`);
          resolve('');
        } else {
          console.log(`[TSV PARSER] Successfully parsed: ${filePath} (${fullText.length} characters, ${output.length} rows)`);
          resolve(fullText);
        }
      });
      
      parser.write(content);
      parser.end();
    });
    
  } catch (error) {
    console.error(`Failed to parse TSV file ${filePath}:`, error);
    return '';
  }
}

export const TSV_PARSER_VERSION = CSV_PARSER_VERSION;