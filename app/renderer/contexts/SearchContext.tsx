import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { SearchHit } from '../../electron/preload';

interface SearchContextType {
  query: string;
  results: SearchHit[];
  loading: boolean;
  expandedFiles: Set<string>;
  setQuery: (query: string) => void;
  setResults: (results: SearchHit[]) => void;
  setLoading: (loading: boolean) => void;
  toggleExpanded: (path: string) => void;
  clearExpanded: () => void;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  
  const toggleExpanded = useCallback((path: string) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }, []);
  
  const clearExpanded = useCallback(() => {
    setExpandedFiles(new Set());
  }, []);
  
  return (
    <SearchContext.Provider value={{
      query,
      results,
      loading,
      expandedFiles,
      setQuery,
      setResults,
      setLoading,
      toggleExpanded,
      clearExpanded
    }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearchContext() {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearchContext must be used within SearchProvider');
  }
  return context;
}