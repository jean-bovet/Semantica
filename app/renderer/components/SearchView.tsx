import React, { useCallback, useRef, useEffect } from 'react';
import { useSearchContext } from '../contexts/SearchContext';
import SearchResult from './SearchResult';
import './SearchView.css';

function SearchView() {
  const { 
    query, 
    results, 
    loading, 
    expandedFiles,
    setQuery, 
    setResults, 
    setLoading,
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
      } catch (err) {
        console.error('Search failed:', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }
  }, [query, setResults, setLoading, clearExpanded]);
  
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
            onChange={(e) => setQuery(e.target.value)}
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
              <div className="file-header" onClick={() => toggleExpanded(path)}>
                <div className="file-info">
                  <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                  <h3>{fileResults[0].title || path.split('/').pop()}</h3>
                  <span className="match-count">{fileResults.length} {fileResults.length === 1 ? 'match' : 'matches'}</span>
                  <span className="best-score">{(bestResult.score * 100).toFixed(0)}%</span>
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
        
        {results.length === 0 && query && !loading && (
          <div className="no-results">
            No results found for "{query}"
          </div>
        )}
      </div>
    </div>
  );
}

export default SearchView;