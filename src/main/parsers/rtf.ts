import fs from 'node:fs';
import { logger } from '../../shared/utils/logger';

// Parser version - single source of truth (imported by parserVersions.ts)
export const PARSER_VERSION = 1; // Version 1: Basic RTF stripping

export async function parseRtf(filePath: string): Promise<string> {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Basic RTF to plain text conversion
    // Remove RTF control words and groups
    let text = content
      // Remove RTF header
      .replace(/^{\\rtf[^}]*}/, '')
      // Remove font tables, color tables, etc.
      .replace(/{\\[*]?[\w\d]+[^}]*}/g, '')
      // Remove control words
      .replace(/\\[a-z]+[-]?\d*\s?/gi, '')
      // Remove escaped characters
      .replace(/\\'/g, '')
      // Remove curly braces
      .replace(/[{}]/g, '')
      // Clean up whitespace
      .replace(/\s+/g, ' ')
      .trim();
    
    return text;
  } catch (error) {
    logger.error('INDEXING', `Failed to parse RTF ${filePath}:`, error);
    return '';
  }
}