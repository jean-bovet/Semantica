import { useState, useCallback, useRef } from 'react';
import type { SearchHit } from '../../electron/preload';

export function useSearch() {
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();
  
  const search = useCallback(async (query: string, immediate = false) => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    
    const doSearch = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const hits = await window.api.search.query(query, 100);
        setResults(hits);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
      } finally {
        setLoading(false);
      }
    };
    
    if (immediate) {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      await doSearch();
    } else {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      
      debounceTimer.current = setTimeout(doSearch, 200);
    }
  }, []);
  
  const clear = useCallback(() => {
    setResults([]);
    setError(null);
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
  }, []);
  
  return {
    results,
    loading,
    error,
    search,
    clear
  };
}