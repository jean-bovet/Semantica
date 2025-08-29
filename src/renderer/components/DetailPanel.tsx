import React from 'react';
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
  onClose: () => void;
  onOpenFile: (path: string, page?: number) => void;
  onShowInFinder: (path: string) => void;
}

function DetailPanel({ 
  isOpen, 
  selectedFile, 
  results, 
  query, 
  onClose,
  onOpenFile,
  onShowInFinder
}: DetailPanelProps) {
  if (!isOpen || !selectedFile) return null;

  const fileResults = results.filter(r => r.path === selectedFile);
  const fileName = selectedFile.split('/').pop() || selectedFile;
  const fileTitle = fileResults[0]?.title || fileName;

  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    let highlightedText = text;
    
    words.forEach(word => {
      const regex = new RegExp(`(${word})`, 'gi');
      highlightedText = highlightedText.replace(regex, '<mark>$1</mark>');
    });
    
    return highlightedText;
  };

  const truncateContext = (text: string, maxLength: number = 200) => {
    if (text.length <= maxLength) return text;
    
    const halfLength = Math.floor(maxLength / 2);
    const start = text.substring(0, halfLength);
    const end = text.substring(text.length - halfLength);
    
    return `${start}...${end}`;
  };

  return (
    <>
      <div className={`detail-panel-overlay ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <div className={`detail-panel ${isOpen ? 'open' : ''}`}>
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
          {fileResults.map((result, index) => (
            <div key={`${result.id}-${index}`} className="match-item">
              <div className="match-header">
                <span className="match-number">Match {index + 1}</span>
                {result.page && <span className="match-page">Page {result.page}</span>}
                <span className="match-score">{(result.score * 100).toFixed(0)}%</span>
              </div>
              <div 
                className="match-text"
                dangerouslySetInnerHTML={{ 
                  __html: highlightText(truncateContext(result.text), query) 
                }}
              />
            </div>
          ))}
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