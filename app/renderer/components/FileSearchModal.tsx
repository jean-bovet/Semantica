import React, { useState, useEffect, useRef } from 'react';
import './FileSearchModal.css';

interface FileSearchResult {
  path: string;
  status: 'indexed' | 'queued' | 'error' | 'not_indexed';
  chunks?: number;
  queuePosition?: number;
  error?: string;
  modified?: string;
  fileType?: string;
}

interface FileSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function FileSearchModal({ isOpen, onClose }: FileSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<NodeJS.Timeout>();
  
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setQuery('');
      setResults([]);
    }
  }, [isOpen]);
  
  useEffect(() => {
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }
    
    if (query.trim()) {
      searchTimeout.current = setTimeout(() => {
        performSearch(query);
      }, 300);
    } else {
      setResults([]);
    }
    
    return () => {
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
    };
  }, [query]);
  
  const performSearch = async (searchQuery: string) => {
    setLoading(true);
    try {
      const searchResults = await window.api.indexer.searchFiles(searchQuery);
      setResults(searchResults);
    } catch (err) {
      console.error('File search failed:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };
  
  const handleOpen = (path: string) => {
    window.api.system.openPreview(path, 0);
  };
  
  const handleShowInFinder = (path: string) => {
    window.api.system.openPath(path);
  };
  
  const getStatusIcon = (status: FileSearchResult['status']) => {
    switch (status) {
      case 'indexed':
        return '✓';
      case 'queued':
        return '⏳';
      case 'error':
        return '✗';
      case 'not_indexed':
        return '—';
      default:
        return '?';
    }
  };
  
  const getStatusText = (result: FileSearchResult) => {
    switch (result.status) {
      case 'indexed':
        return `Indexed (${result.chunks} chunks)`;
      case 'queued':
        return `In Queue (position ${result.queuePosition})`;
      case 'error':
        return `Error: ${result.error}`;
      case 'not_indexed':
        return 'Not indexed';
      default:
        return 'Unknown status';
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <>
      <div className="file-search-backdrop" onClick={onClose} />
      <div className="file-search-container">
        <div className="file-search-content">
          <div className="file-search-header">
            <h3 className="file-search-title">File Search</h3>
            <button className="file-search-close" onClick={onClose}>
              ×
            </button>
          </div>
          
          <div className="file-search-input-wrapper">
            <svg 
              className="file-search-icon"
              width="16" 
              height="16" 
              viewBox="0 0 20 20" 
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter filename to search..."
              className="file-search-input"
            />
          </div>
          
          <div className="file-search-results">
            {loading && (
              <div className="file-search-loading">Searching...</div>
            )}
            
            {!loading && results.length === 0 && query.trim() && (
              <div className="file-search-empty">
                No files found matching "{query}"
              </div>
            )}
            
            {!loading && results.map((result, index) => (
              <div key={index} className={`file-search-result status-${result.status}`}>
                <div className="file-search-result-header">
                  <span className={`file-status-icon ${result.status}`}>
                    {getStatusIcon(result.status)}
                  </span>
                  <span className="file-name">
                    {result.path.split('/').pop()}
                  </span>
                </div>
                
                <div className="file-path">{result.path}</div>
                
                <div className="file-search-result-footer">
                  <span className="file-status-text">
                    {getStatusText(result)}
                  </span>
                  {result.modified && (
                    <span className="file-modified">
                      Modified: {new Date(result.modified).toLocaleString()}
                    </span>
                  )}
                </div>
                
                <div className="file-search-actions">
                  <button 
                    className="file-action-button"
                    onClick={() => handleOpen(result.path)}
                    title="Open"
                  >
                    Open
                  </button>
                  <button 
                    className="file-action-button secondary"
                    onClick={() => handleShowInFinder(result.path)}
                    title="Show in Finder"
                  >
                    Show in Finder
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default FileSearchModal;