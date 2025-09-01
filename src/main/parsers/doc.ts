const WordExtractor = require('word-extractor');
const extractor = new WordExtractor();

// Parser version - single source of truth (imported by parserVersions.ts)
export const PARSER_VERSION = 2; // Version 2: Proper binary .doc support with word-extractor

export async function parseDoc(filePath: string): Promise<string> {
  try {
    const doc = await extractor.extract(filePath);
    
    // Get the main body text
    let text = doc.getBody();
    
    // Optionally include headers and footers
    const headers = doc.getHeaders();
    const footers = doc.getFooters();
    
    if (headers && headers.trim()) {
      text = headers + '\n\n' + text;
    }
    
    if (footers && footers.trim()) {
      text = text + '\n\n' + footers;
    }
    
    // Clean up excessive whitespace
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    
    if (!text || text.length === 0) {
      throw new Error('No text content extracted from .doc file');
    }
    
    return text;
  } catch (error: any) {
    console.error(`Failed to parse .doc file ${filePath}:`, error.message);
    throw error; // Re-throw to be caught by the worker
  }
}