import React, { useCallback, useRef, useEffect, useState } from 'react';
import { useSearchContext } from '../contexts/SearchContext';
import ResultsList from './ResultsList';
import DetailPanel from './DetailPanel';
import './SearchView.css';

function SearchView() {
  const { 
    query, 
    results, 
    loading, 
    hasSearched,
    setQuery, 
    setResults, 
    setLoading,
    setHasSearched,
    clearExpanded 
  } = useSearchContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(40);
  
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  
  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      // Clear any pending debounce
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      
      setLoading(true);
      clearExpanded(); // Reset expanded state on new search
      setSelectedFile(null); // Clear selection on new search
      setIsPanelOpen(false);
      
      try {
        const hits = await window.api.search.query(query, 100);
        setResults(hits);
        setHasSearched(true);
      } catch (err) {
        console.error('Search failed:', err);
        setResults([]);
        setHasSearched(true);
      } finally {
        setLoading(false);
      }
    }
  }, [query, setResults, setLoading, setHasSearched, clearExpanded]);
  
  const handleFileSelect = useCallback((path: string) => {
    if (selectedFile === path && isPanelOpen) {
      setIsPanelOpen(false);
      setSelectedFile(null);
    } else {
      setSelectedFile(path);
      setIsPanelOpen(true);
    }
  }, [selectedFile, isPanelOpen]);
  
  const handlePanelClose = useCallback(() => {
    setIsPanelOpen(false);
    setSelectedFile(null);
  }, []);
  
  const handleOpenFile = useCallback(async (path: string, page?: number) => {
    await window.api.system.openPreview(path, page);
  }, []);
  
  const handleShowInFinder = useCallback(async (path: string) => {
    await window.api.system.openPath(path);
  }, []);
  
  return (
    <div className="search-view">
      <div className="search-header">
        <form onSubmit={handleSearch} className="search-form">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value === '') {
                setHasSearched(false);
                setResults([]);
                setSelectedFile(null);
                setIsPanelOpen(false);
              }
            }}
            placeholder="Search your documents..."
            className="search-input"
            data-testid="search-input"
          />
          <button type="submit" className="search-button" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>
      
      <div 
        className={`search-results ${isPanelOpen ? 'panel-open' : ''}`}
        style={isPanelOpen ? { marginRight: `${panelWidth}%` } : {}}
      >
        {results.length > 0 && (
          <ResultsList
            results={results}
            selectedFile={selectedFile}
            onFileSelect={handleFileSelect}
            onOpenFile={handleOpenFile}
            onShowInFinder={handleShowInFinder}
          />
        )}
        
        {results.length === 0 && hasSearched && !loading && (
          <div className="no-results">
            No results found for "{query}"
          </div>
        )}
        
        {results.length === 0 && !hasSearched && !loading && (
          <div className="empty-state">
            <svg width="120" height="120" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Outer compass ring */}
              <circle cx="40" cy="40" r="28" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.2"/>
              
              {/* Inner compass ring */}
              <circle cx="40" cy="40" r="22" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.15"/>
              
              {/* Compass needle pointing north */}
              <path d="M40 18L44 36L40 40L36 36L40 18Z" fill="currentColor" opacity="0.35"/>
              <path d="M40 62L36 44L40 40L44 44L40 62Z" fill="currentColor" opacity="0.15"/>
              
              {/* Cardinal direction markers */}
              <circle cx="40" cy="12" r="1.5" fill="currentColor" opacity="0.4"/>
              <circle cx="68" cy="40" r="1.5" fill="currentColor" opacity="0.2"/>
              <circle cx="40" cy="68" r="1.5" fill="currentColor" opacity="0.2"/>
              <circle cx="12" cy="40" r="1.5" fill="currentColor" opacity="0.2"/>
              
              {/* Center pivot */}
              <circle cx="40" cy="40" r="3" fill="currentColor" opacity="0.3"/>
              <circle cx="40" cy="40" r="1.5" fill="currentColor" opacity="0.5"/>
            </svg>
            <p className="empty-state-hint">Type your query and press Enter</p>
          </div>
        )}
      </div>
      
      <DetailPanel
        isOpen={isPanelOpen}
        selectedFile={selectedFile}
        results={results}
        query={query}
        width={panelWidth}
        onClose={handlePanelClose}
        onWidthChange={setPanelWidth}
        onOpenFile={handleOpenFile}
        onShowInFinder={handleShowInFinder}
      />
    </div>
  );
}

export default SearchView;