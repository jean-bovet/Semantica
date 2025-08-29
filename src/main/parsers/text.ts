import fs from 'node:fs/promises';
import path from 'node:path';

export const PARSER_VERSION = 1; // Version 1: Basic text/markdown parsing

export async function parseText(filePath: string): Promise<string> {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const content = await fs.readFile(filePath, 'utf8');
    
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