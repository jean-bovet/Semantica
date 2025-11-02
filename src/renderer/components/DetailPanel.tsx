import React, { useState, useEffect, useRef } from 'react';
import './DetailPanel.css';

interface Result {
  id: string;
  path: string;
  title?: string;
  text: string;
  score: number;
  page?: number;
  offset?: number;
}

interface DetailPanelProps {
  isOpen: boolean;
  selectedFile: string | null;
  results: Result[];
  query: string;
  width: number;
  onClose: () => void;
  onWidthChange: (width: number) => void;
  onOpenFile: (path: string, page?: number) => void;
  onShowInFinder: (path: string) => void;
}

function DetailPanel({ 
  isOpen, 
  selectedFile, 
  results, 
  query,
  width,
  onClose,
  onWidthChange,
  onOpenFile,
  onShowInFinder
}: DetailPanelProps) {
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const newWidth = ((window.innerWidth - e.clientX) / window.innerWidth) * 100;
      // Limit width between 20% and 80%
      const clampedWidth = Math.max(20, Math.min(80, newWidth));
      onWidthChange(clampedWidth);
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
    };
    
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);
  
  if (!isOpen || !selectedFile) return null;

  const fileResults = results.filter(r => r.path === selectedFile);
  const fileName = selectedFile.split('/').pop() || selectedFile;
  const fileTitle = fileResults[0]?.title || fileName;

  const highlightText = (text: string, query: string): { html: string; matchType: 'keyword' | 'semantic' } => {
    if (!query.trim()) return { html: text, matchType: 'semantic' };

    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    let highlightedText = text;
    let foundMatches = false;

    words.forEach(word => {
      // Escape special regex characters
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedWord})`, 'gi');
      const beforeReplace = highlightedText;
      highlightedText = highlightedText.replace(regex, '<mark>$1</mark>');
      if (highlightedText !== beforeReplace) {
        foundMatches = true;
      }
    });

    // If no keyword matches found, this is a pure semantic match
    const matchType = foundMatches ? 'keyword' : 'semantic';
    return { html: highlightedText, matchType };
  };

  const truncateContext = (text: string, maxChars: number = 400) => {
    // If text is short enough, return as-is
    if (text.length <= maxChars) return text;

    // Find sentence boundaries (periods, exclamation marks, question marks followed by space or end)
    const sentenceRegex = /[.!?](?:\s|$)/g;
    const sentences: Array<{ text: string; start: number; end: number }> = [];
    let match;
    let lastIndex = 0;

    while ((match = sentenceRegex.exec(text)) !== null) {
      const sentenceText = text.substring(lastIndex, match.index + 1).trim();
      if (sentenceText) {
        sentences.push({
          text: sentenceText,
          start: lastIndex,
          end: match.index + 1
        });
      }
      lastIndex = match.index + 1;
    }

    // Add remaining text as last sentence if any
    if (lastIndex < text.length) {
      const remaining = text.substring(lastIndex).trim();
      if (remaining) {
        sentences.push({
          text: remaining,
          start: lastIndex,
          end: text.length
        });
      }
    }

    // If no sentences found, fall back to character truncation
    if (sentences.length === 0) {
      return text.substring(0, maxChars) + '...';
    }

    // Try to show 2-3 complete sentences around the middle
    const targetSentences = Math.min(3, sentences.length);
    const middleIndex = Math.floor(sentences.length / 2);
    const startIndex = Math.max(0, middleIndex - Math.floor(targetSentences / 2));
    const endIndex = Math.min(sentences.length, startIndex + targetSentences);

    const selectedSentences = sentences.slice(startIndex, endIndex);
    const result = selectedSentences.map(s => s.text).join(' ');

    // If still too long, just take first N characters and add ellipsis
    if (result.length > maxChars) {
      return text.substring(0, maxChars) + '...';
    }

    // Add ellipsis indicators if we're not showing everything
    const prefix = startIndex > 0 ? '... ' : '';
    const suffix = endIndex < sentences.length ? ' ...' : '';

    return prefix + result + suffix;
  };

  return (
    <>
      <div 
        ref={panelRef}
        className={`detail-panel ${isOpen ? 'open' : ''}`}
        style={{ width: `${width}%`, right: isOpen ? 0 : `-${width}%` }}
      >
        <div 
          className="detail-resize-handle"
          onMouseDown={() => setIsResizing(true)}
        />
        <div className="detail-header">
          <div className="detail-title-row">
            <h3 className="detail-title">{fileTitle}</h3>
            <button className="detail-close" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
              </svg>
            </button>
          </div>
          <div className="detail-path">{selectedFile}</div>
          <div className="detail-stats">
            {fileResults.length} {fileResults.length === 1 ? 'match' : 'matches'} found
          </div>
        </div>

        <div className="detail-matches">
          {fileResults.map((result, index) => {
            const truncatedText = truncateContext(result.text);
            const highlighted = highlightText(truncatedText, query);
            const isTruncated = truncatedText !== result.text;

            return (
              <div key={`${result.id}-${index}`} className="match-item">
                <div className="match-header">
                  <span className="match-number">Match {index + 1}</span>
                  {result.page && <span className="match-page">Page {result.page}</span>}
                  <span className="match-score">{(result.score * 100).toFixed(0)}%</span>
                  <span className={`match-type-badge ${highlighted.matchType}`}>
                    {highlighted.matchType === 'keyword' ? (
                      <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" style={{ marginRight: '4px' }}>
                        <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" style={{ marginRight: '4px' }}>
                        <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                      </svg>
                    )}
                    {highlighted.matchType}
                  </span>
                </div>
                <div
                  className="match-text"
                  dangerouslySetInnerHTML={{ __html: highlighted.html }}
                />
                {isTruncated && (
                  <button
                    className="show-full-text-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      const textDiv = e.currentTarget.previousElementSibling as HTMLDivElement;
                      const fullHighlighted = highlightText(result.text, query);
                      if (textDiv.classList.contains('expanded')) {
                        textDiv.innerHTML = highlighted.html;
                        textDiv.classList.remove('expanded');
                        e.currentTarget.textContent = 'Show full text';
                      } else {
                        textDiv.innerHTML = fullHighlighted.html;
                        textDiv.classList.add('expanded');
                        e.currentTarget.textContent = 'Show less';
                      }
                    }}
                  >
                    Show full text
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="detail-actions">
          <button 
            className="detail-action-button primary"
            onClick={() => onOpenFile(selectedFile, fileResults[0]?.page)}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
            Open File
          </button>
          <button 
            className="detail-action-button"
            onClick={() => onShowInFinder(selectedFile)}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
            Show in Finder
          </button>
        </div>
      </div>
    </>
  );
}

export default DetailPanel;