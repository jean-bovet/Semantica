import mammoth from 'mammoth';
import fs from 'node:fs';

export async function parseDocx(filePath: string): Promise<string> {
  try {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    
    // Clean up the text
    const text = result.value
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    
    if (result.messages.length > 0) {
      console.warn(`DOCX warnings for ${filePath}:`, result.messages);
    }
    
    return text;
  } catch (error) {
    console.error(`Failed to parse DOCX ${filePath}:`, error);
    return '';
  }
}