import crypto from 'node:crypto';

export function mockEmbed(texts: string[], dim: number = 768, isQuery = false): number[][] {
  // Apply E5 prefixes to match production behavior
  const prefixedTexts = texts.map(text => {
    const prefix = isQuery ? 'query: ' : 'passage: ';
    return prefix + text;
  });
  
  return prefixedTexts.map(text => {
    const hash = crypto.createHash('sha1').update(text).digest();
    const vector = new Float32Array(dim);
    
    for (let i = 0; i < dim; i++) {
      vector[i] = ((hash[i % hash.length] - 128) / 128);
    }
    
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    
    for (let i = 0; i < dim; i++) {
      vector[i] /= norm || 1;
    }
    
    return Array.from(vector);
  });
}