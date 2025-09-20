import { detect } from 'chardet';
import iconv from 'iconv-lite';
import { logger } from '../../shared/utils/logger';

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
    
    // Strategy 4: Handle chardet's encoding names and special cases
    if (encoding) {
      // Normalize encoding names for iconv-lite compatibility
      encoding = encoding.replace(/^ISO-8859-/i, 'ISO-8859-');
      encoding = encoding.replace(/^windows-/i, 'windows-');
      
      // Mac Roman special handling
      // Chardet sometimes misdetects Mac Roman as Windows-1252 or ISO-8859-1
      if (encoding === 'windows-1252' || encoding === 'ISO-8859-1') {
        // Check for Mac Roman specific byte patterns
        for (let i = 0; i < Math.min(buffer.length, 1000); i++) {
          // Mac Roman uses specific bytes in the 0x80-0x9F range differently
          // 0x8E is é in Mac Roman (common in "café")
          // 0xD0 is — (em dash) in Mac Roman but Ð in ISO-8859-1
          if (buffer[i] === 0x8E || buffer[i] === 0xD0) {
            // Check context to confirm Mac Roman
            const prevChar = i > 0 ? buffer[i-1] : 0;
            const nextChar = i < buffer.length - 1 ? buffer[i+1] : 0;
            // Mac Roman is more likely if surrounded by ASCII chars
            if ((prevChar >= 0x20 && prevChar <= 0x7E) || 
                (nextChar >= 0x20 && nextChar <= 0x7E)) {
              encoding = 'macintosh';
              break;
            }
          }
        }
      }
    }
  }
  
  if (filename) {
    logger.log('ENCODING', `File: ${filename}, Detected: ${encoding}`);
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
    try {
      const decoded = iconv.decode(buffer, finalEncoding);
      // Verify the decode worked (should have reasonable content)
      if (decoded && decoded.length > 0) {
        return decoded;
      }
    } catch (error) {
      logger.warn('ENCODING', `Failed to decode with ${finalEncoding}, trying fallbacks`, error);
    }
  }
  
  // Try common fallback encodings
  const fallbackEncodings = ['ISO-8859-1', 'windows-1252', 'utf8'];
  for (const fallback of fallbackEncodings) {
    try {
      if (iconv.encodingExists(fallback)) {
        const decoded = iconv.decode(buffer, fallback);
        if (decoded && decoded.length > 0) {
          logger.log('ENCODING', `Used fallback encoding: ${fallback}`);
          return decoded;
        }
      }
    } catch (_error) {
      // Continue to next fallback
    }
  }
  
  // Last resort: UTF-8 with replacement chars
  return buffer.toString('utf8');
}