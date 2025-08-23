import React from 'react';
import './StatusBar.css';

interface StatusBarProps {
  progress: {
    queued: number;
    processing: number;
    done: number;
    errors: number;
    paused: boolean;
  };
}

function StatusBar({ progress }: StatusBarProps) {
  const getStatusText = () => {
    if (progress.paused) {
      return 'Indexing paused';
    }
    if (progress.processing > 0) {
      return `Indexing ${progress.processing} file${progress.processing > 1 ? 's' : ''}...`;
    }
    if (progress.queued > 0) {
      return `${progress.queued} file${progress.queued > 1 ? 's' : ''} queued`;
    }
    return 'Ready';
  };
  
  const isActive = progress.queued > 0 || progress.processing > 0;
  
  return (
    <div className={`status-bar ${isActive ? 'active' : ''}`}>
      <div className="status-content">
        <span className="status-text">{getStatusText()}</span>
        {progress.done > 0 && (
          <span className="status-stats">
            {progress.done} indexed
            {progress.errors > 0 && ` • ${progress.errors} errors`}
          </span>
        )}
      </div>
      {isActive && !progress.paused && (
        <div className="status-indicator">
          <div className="pulse"></div>
        </div>
      )}
    </div>
  );
}

export default StatusBar;