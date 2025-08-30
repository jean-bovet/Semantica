import { detect } from 'chardet';
import iconv from 'iconv-lite';

/**
 * Detects the encoding of a buffer using multiple strategies:
 * 1. UTF-16 BOM detection
 * 2. UTF-16 heuristic detection (for files without BOM)
 * 3. Chardet library detection
 * 4. Mac Roman special case handling
 * 
 * @param buffer The file buffer to analyze
 * @param filename Optional filename for logging
 * @returns The detected encoding name compatible with iconv-lite
 */
export function detectEncoding(buffer: Buffer, filename?: string): string | null {
  let encoding: string | null = null;
  
  // Strategy 1: Check for UTF-16 BOMs
  if (buffer.length >= 2) {
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
      encoding = 'utf16le';
    } else if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
      encoding = 'utf16be';
    } else if (buffer.length >= 20) {
      // Strategy 2: Heuristic for UTF-16LE without BOM
      // Check if every other byte is 0x00 for ASCII text
      let nullCount = 0;
      let evenNulls = 0;
      let oddNulls = 0;
      
      for (let i = 0; i < Math.min(100, buffer.length); i++) {
        if (buffer[i] === 0x00) {
          nullCount++;
          if (i % 2 === 0) evenNulls++;
          else oddNulls++;
        }
      }
      
      // If we have many nulls and they're mostly in odd positions (for LE), it's likely UTF-16LE
      if (nullCount > 20 && oddNulls > evenNulls * 2) {
        encoding = 'utf16le';
      }
    }
  }
  
  // Strategy 3: Use chardet library for other encodings
  if (!encoding) {
    encoding = detect(buffer);
    
    // Strategy 4: Mac Roman special handling
    // Chardet sometimes misdetects Mac Roman as Windows-1252 or ISO-8859-1
    if (encoding === 'windows-1252' || encoding === 'ISO-8859-1') {
      for (let i = 0; i < Math.min(buffer.length, 1000); i++) {
        // Mac Roman uses specific bytes in the 0x80-0x9F range differently
        // 0x8E is é in Mac Roman (common in "café")
        if (buffer[i] === 0x8E) {
          encoding = 'macintosh';
          break;
        }
      }
    }
  }
  
  if (filename) {
    console.log(`[ENCODING] File: ${filename}, Detected: ${encoding}`);
  }
  
  return encoding;
}

/**
 * Converts a buffer to UTF-8 string using the detected or specified encoding
 * 
 * @param buffer The buffer to convert
 * @param encoding Optional encoding to use (if not provided, will detect)
 * @param filename Optional filename for logging
 * @returns UTF-8 string
 */
export function decodeBuffer(buffer: Buffer, encoding?: string | null, filename?: string): string {
  const finalEncoding = encoding || detectEncoding(buffer, filename);
  
  if (finalEncoding && iconv.encodingExists(finalEncoding)) {
    return iconv.decode(buffer, finalEncoding);
  }
  
  // Fallback to UTF-8
  return buffer.toString('utf8');
}