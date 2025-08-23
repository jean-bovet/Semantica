import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSearch } from '../hooks/useSearch';
import SearchResult from './SearchResult';
import './SearchView.css';

function SearchView() {
  const [query, setQuery] = useState('');
  const { results, loading, search } = useSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  
  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      search(query);
    }
  }, [query, search]);
  
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.path]) {
      acc[result.path] = [];
    }
    acc[result.path].push(result);
    return acc;
  }, {} as Record<string, typeof results>);
  
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
        {Object.entries(groupedResults).map(([path, fileResults]) => (
          <div key={path} className="file-group">
            <div className="file-header">
              <h3>{fileResults[0].title || path.split('/').pop()}</h3>
              <span className="match-count">{fileResults.length} matches</span>
            </div>
            {fileResults.slice(0, 3).map((result) => (
              <SearchResult key={result.id} result={result} query={query} />
            ))}
          </div>
        ))}
        
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