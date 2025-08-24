import React from 'react';
import type { SearchHit } from '../../electron/preload';
import './SearchResult.css';

interface SearchResultProps {
  result: SearchHit;
  query: string;
}

function SearchResult({ result, query }: SearchResultProps) {
  const highlightText = (text: string, query: string) => {
    const parts = query.toLowerCase().split(/\s+/);
    let highlighted = text;
    
    parts.forEach(part => {
      const regex = new RegExp(`(${part})`, 'gi');
      highlighted = highlighted.replace(regex, '<mark>$1</mark>');
    });
    
    return { __html: highlighted };
  };
  
  const getSnippet = (text: string, maxLength: number = 200) => {
    if (text.length <= maxLength) return text;
    
    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();
    const index = textLower.indexOf(queryLower.split(/\s+/)[0]);
    
    if (index === -1) {
      return text.substring(0, maxLength) + '...';
    }
    
    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, start + maxLength);
    
    let snippet = text.substring(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';
    
    return snippet;
  };
  
  return (
    <div className="search-result">
      <div className="result-content">
        <div className="result-snippet" 
             dangerouslySetInnerHTML={highlightText(getSnippet(result.text), query)} />
        <div className="result-meta">
          {result.page > 0 && <span className="page-number">Page {result.page}</span>}
          <span className="score">Score: {(result.score * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

export default SearchResult;