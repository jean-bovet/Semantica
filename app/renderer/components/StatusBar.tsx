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
    
    const remaining = progress.queued + progress.processing;
    if (remaining > 0) {
      return `${remaining} file${remaining !== 1 ? 's' : ''} remaining`;
    }
    
    return 'Ready';
  };
  
  const isActive = progress.queued > 0 || progress.processing > 0;
  
  return (
    <div className={`status-bar ${isActive ? 'active' : ''}`}>
      <div className="status-content">
        <span className="status-text">{getStatusText()}</span>
        {progress.errors > 0 && (
          <span className="status-stats">
            {progress.errors} errors
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