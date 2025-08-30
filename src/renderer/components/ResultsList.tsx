import React from 'react';
import './ResultsList.css';

interface Result {
  id: string;
  path: string;
  title?: string;
  text: string;
  score: number;
  page?: number;
  offset?: number;
}

interface ResultsListProps {
  results: Result[];
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
  onOpenFile: (path: string, page?: number) => void;
  onShowInFinder: (path: string) => void;
}

function ResultsList({ 
  results, 
  selectedFile, 
  onFileSelect, 
  onOpenFile, 
  onShowInFinder 
}: ResultsListProps) {
  // Group results by file
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.path]) {
      acc[result.path] = [];
    }
    acc[result.path].push(result);
    return acc;
  }, {} as Record<string, Result[]>);

  const getFileName = (path: string) => {
    return path.split('/').pop() || path;
  };

  const getBestScore = (fileResults: Result[]) => {
    return Math.max(...fileResults.map(r => r.score));
  };

  return (
    <div className="results-list">
      {Object.entries(groupedResults).map(([path, fileResults]) => {
        const fileName = getFileName(path);
        const bestScore = getBestScore(fileResults);
        const isSelected = selectedFile === path;
        
        return (
          <div 
            key={path}
            className={`result-row ${isSelected ? 'selected' : ''}`}
            onClick={() => onFileSelect(path)}
          >
            <div className="result-info">
              <span className="result-name">{fileResults[0].title || fileName}</span>
              {isSelected && <span className="result-check">✓</span>}
              <span className="result-score">{(bestScore * 100).toFixed(0)}%</span>
            </div>
            
            <div className="result-actions" onClick={e => e.stopPropagation()}>
              <button 
                type="button"
                className="action-button"
                onClick={() => onOpenFile(path, fileResults[0].page)}
                title="Open file"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
              </button>
              <button 
                type="button"
                className="action-button"
                onClick={() => onShowInFinder(path)}
                title="Show in Finder"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ResultsList;