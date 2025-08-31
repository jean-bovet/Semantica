export interface Chunk {
  text: string;
  offset: number;
  startChar?: number;
  endChar?: number;
}

/**
 * Smart chunking with sentence boundaries and edge case handling
 * Optimized for ~1000 characters per chunk (250 tokens)
 */
export function chunkText(
  text: string,
  targetChars: number = 1000,  // Changed from tokens to chars for clarity
  overlapChars: number = 100   // 10% overlap
): Chunk[] {
  if (!text || text.trim().length === 0) {
    return [];
  }
  
  // Handle common abbreviations to avoid incorrect splits
  const preserved = text
    .replace(/\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr)\./g, '$1<DOT>')
    .replace(/\b(Inc|Ltd|Corp|Co)\./g, '$1<DOT>')
    .replace(/\b(U\.S|U\.K|E\.U)\./g, match => match.replace(/\./g, '<DOT>'))
    .replace(/\b(e\.g|i\.e|etc)\./g, match => match.replace(/\./g, '<DOT>'));
  
  // Split on sentence boundaries
  const sentences = preserved.split(/(?<=[.!?])\s+/);
  
  // Restore dots
  const restoredSentences = sentences.map(s => s.replace(/<DOT>/g, '.'));
  
  const chunks: Chunk[] = [];
  const MIN_CHUNK_SIZE = 800;
  const MAX_CHUNK_SIZE = 1200;
  const MAX_SENTENCE_LENGTH = 800;
  
  let buffer: string[] = [];
  let currentOffset = 0;
  let bufferLength = 0;
  let originalIndex = 0;
  
  for (const sentence of restoredSentences) {
    // Break very long sentences
    const parts = breakLongSentence(sentence, MAX_SENTENCE_LENGTH);
    
    for (const part of parts) {
      const partLength = part.length;
      
      // Check if adding this part would exceed target
      if (bufferLength + partLength > targetChars && 
          buffer.length > 0 && 
          bufferLength >= MIN_CHUNK_SIZE) {
        
        // Create chunk
        const chunkText = buffer.join(' ');
        const startChar = currentOffset;
        const endChar = originalIndex - 1;
        
        chunks.push({
          text: chunkText,
          offset: currentOffset,
          startChar,
          endChar
        });
        
        // Keep overlap for context
        while (buffer.length > 0 && bufferLength > overlapChars) {
          const removed = buffer.shift()!;
          currentOffset += removed.length + 1;
          bufferLength -= removed.length + 1;
        }
      }
      
      buffer.push(part);
      bufferLength += partLength + (buffer.length > 1 ? 1 : 0); // Add space if not first
      originalIndex += partLength + 1;
    }
  }
  
  // Add remaining buffer as final chunk
  if (buffer.length > 0) {
    const chunkText = buffer.join(' ');
    chunks.push({
      text: chunkText,
      offset: currentOffset,
      startChar: currentOffset,
      endChar: originalIndex
    });
  }
  
  return chunks;
}

/**
 * Break long sentences at word boundaries
 */
function breakLongSentence(sentence: string, maxLength: number): string[] {
  if (sentence.length <= maxLength) return [sentence];
  
  const parts: string[] = [];
  let remaining = sentence;
  
  while (remaining.length > maxLength) {
    // Try to break at word boundary
    let breakPoint = remaining.lastIndexOf(' ', maxLength);
    if (breakPoint === -1 || breakPoint < maxLength * 0.5) {
      // If no good break point, break at maxLength
      breakPoint = maxLength;
    }
    
    parts.push(remaining.substring(0, breakPoint).trim());
    remaining = remaining.substring(breakPoint).trim();
  }
  
  if (remaining) {
    parts.push(remaining);
  }
  
  return parts;
}