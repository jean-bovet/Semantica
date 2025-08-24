import React, { useState, useEffect } from 'react';
import './StatusBar.css';

interface StatusBarProps {
  progress: {
    queued: number;
    processing: number;
    done: number;
    errors: number;
    paused: boolean;
  };
  onSettingsClick: () => void;
}

function StatusBar({ progress, onSettingsClick }: StatusBarProps) {
  const [stats, setStats] = useState({ 
    totalChunks: 0, 
    indexedFiles: 0,
    folderStats: [] as Array<{ folder: string; totalFiles: number; indexedFiles: number }>
  });

  useEffect(() => {
    const loadStats = async () => {
      const dbStats = await window.api.db.stats();
      setStats(dbStats);
    };
    
    loadStats();
    const interval = setInterval(loadStats, 5000);
    
    return () => clearInterval(interval);
  }, []);

  const getStatusText = () => {
    if (progress.paused) {
      return '⏸ Paused';
    }
    
    const remaining = progress.queued + progress.processing;
    if (remaining > 0) {
      return `⚡ Indexing (${remaining} remaining)`;
    }
    
    return '✓ Ready';
  };
  
  const isActive = progress.queued > 0 || progress.processing > 0;
  const folderCount = stats.folderStats?.length || 0;
  
  return (
    <div className={`status-bar ${isActive ? 'active' : ''}`}>
      <div className="status-content">
        <div className="status-left">
          <span className="status-stat">📁 {folderCount} folder{folderCount !== 1 ? 's' : ''}</span>
          <span className="status-separator">|</span>
          <span className="status-stat">{stats.indexedFiles.toLocaleString()} files indexed</span>
          <span className="status-separator">|</span>
          <span className="status-stat">{(stats.totalChunks / 1000).toFixed(0)}K chunks</span>
          <span className="status-separator">|</span>
          <span className={`status-indicator-text ${progress.paused ? 'paused' : ''}`}>
            {getStatusText()}
          </span>
        </div>
        
        <button 
          className="settings-button"
          onClick={onSettingsClick}
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
          </svg>
          Settings
        </button>
      </div>
      
      {isActive && !progress.paused && (
        <div className="status-progress-bar">
          <div className="status-progress-fill"></div>
        </div>
      )}
    </div>
  );
}

export default StatusBar;