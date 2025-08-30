import fs from 'node:fs/promises';
import path from 'node:path';
import { detectEncoding, decodeBuffer } from '../utils/encoding-detector';

export const PARSER_VERSION = 3; // Version 3: Multi-encoding support with chardet and iconv-lite

export async function parseText(filePath: string): Promise<string> {
  try {
    const ext = path.extname(filePath).toLowerCase();
    
    // Read file as buffer
    const buffer = await fs.readFile(filePath);
    
    // Detect encoding and convert to UTF-8
    const encoding = detectEncoding(buffer, path.basename(filePath));
    console.log(`[TEXT PARSER] File: ${path.basename(filePath)}, Detected encoding: ${encoding}`);
    
    const content = decodeBuffer(buffer, encoding);
    
    if (ext === '.md') {
      return content
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')
        .replace(/`{1,3}[^`]*`{1,3}/g, '')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '')
        .replace(/^>\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    
    return content.replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.error(`Failed to parse text file ${filePath}:`, error);
    return '';
  }
}