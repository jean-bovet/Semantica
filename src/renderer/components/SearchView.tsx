import React, { useCallback, useRef, useEffect } from 'react';
import { useSearchContext } from '../contexts/SearchContext';
import SearchResult from './SearchResult';
import './SearchView.css';

function SearchView() {
  const { 
    query, 
    results, 
    loading, 
    hasSearched,
    expandedFiles,
    setQuery, 
    setResults, 
    setLoading,
    setHasSearched,
    toggleExpanded,
    clearExpanded 
  } = useSearchContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();
  
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
  
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.path]) {
      acc[result.path] = [];
    }
    acc[result.path].push(result);
    return acc;
  }, {} as Record<string, typeof results>);
  
  // Calculate best score for each file
  const getFileSummary = (fileResults: typeof results) => {
    const bestResult = fileResults.reduce((best, current) => 
      (current.score > best.score) ? current : best
    );
    const avgScore = fileResults.reduce((sum, r) => sum + r.score, 0) / fileResults.length;
    return { bestResult, avgScore };
  };
  
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
              }
            }}
            placeholder="Search your documents..."
            className="search-input"
          />
          <button type="submit" className="search-button" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>
      
      <div className="search-results">
        {Object.entries(groupedResults).map(([path, fileResults]) => {
          const isExpanded = expandedFiles.has(path);
          const { bestResult, avgScore } = getFileSummary(fileResults);
          
          return (
            <div key={path} className="file-group">
              <div className="file-header">
                <div className="file-info" onClick={() => toggleExpanded(path)}>
                  <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                  <h3>{fileResults[0].title || path.split('/').pop()}</h3>
                  <span className="match-count">{fileResults.length} {fileResults.length === 1 ? 'match' : 'matches'}</span>
                  <span className="best-score">{(bestResult.score * 100).toFixed(0)}%</span>
                </div>
                <div className="file-actions">
                  <button 
                    onClick={() => window.api.system.openPreview(path, fileResults[0].page)}
                    className="icon-button"
                    title="Open"
                  >
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                      <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                    </svg>
                  </button>
                  <button 
                    onClick={() => window.api.system.openPath(path)}
                    className="icon-button"
                    title="Show in Finder"
                  >
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  </button>
                </div>
              </div>
              
              {isExpanded && (
                <div className="file-details">
                  {fileResults.map((result, index) => (
                    <SearchResult key={`${result.id}-${index}`} result={result} query={query} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        
        {results.length === 0 && hasSearched && !loading && (
          <div className="no-results">
            No results found for "{query}"
          </div>
        )}
      </div>
    </div>
  );
}

export default SearchView;