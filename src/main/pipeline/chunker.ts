export interface Chunk {
  text: string;
  offset: number;
}

export function chunkText(
  text: string,
  targetTokens: number = 500,
  overlapTokens: number = 80  // Increased for multilingual support
): Chunk[] {
  if (!text || text.trim().length === 0) {
    return [];
  }
  
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: Chunk[] = [];
  
  const estimateTokens = (str: string): number => {
    return Math.ceil(str.length / 4);
  };
  
  let buffer: string[] = [];
  let currentOffset = 0;
  let bufferTokens = 0;
  
  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    
    if (bufferTokens + sentenceTokens > targetTokens && buffer.length > 0) {
      const chunkText = buffer.join(' ');
      chunks.push({
        text: chunkText,
        offset: currentOffset
      });
      
      while (buffer.length > 0 && estimateTokens(buffer.join(' ')) > overlapTokens) {
        const removed = buffer.shift()!;
        currentOffset += removed.length + 1;
      }
      
      bufferTokens = estimateTokens(buffer.join(' '));
    }
    
    buffer.push(sentence);
    bufferTokens += sentenceTokens;
  }
  
  if (buffer.length > 0) {
    chunks.push({
      text: buffer.join(' '),
      offset: currentOffset
    });
  }
  
  return chunks;
}