import React from 'react';
import { Play, Pause, RefreshCw } from 'lucide-react';
import Icon from '../Icon';

interface IndexingSettingsProps {
  stats: {
    totalChunks: number;
    indexedFiles: number;
  };
  progress: any;
  reindexing: boolean;
  dataPath: string;
  onPauseResume: () => void;
  onReindex: () => void;
  onOpenDataPath: () => void;
}

function IndexingSettings({ 
  stats, 
  progress, 
  reindexing, 
  dataPath, 
  onPauseResume, 
  onReindex,
  onOpenDataPath 
}: IndexingSettingsProps) {
  return (
    <div className="settings-section">
      <p className="section-description">
        Manage the indexing process and view statistics about your indexed documents.
      </p>
      
      <div className="stats-card">
        <h4>Statistics</h4>
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-value">{stats.indexedFiles.toLocaleString()}</span>
            <span className="stat-label">Files Indexed</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.totalChunks.toLocaleString()}</span>
            <span className="stat-label">Text Chunks</span>
          </div>
          {progress && (
            <>
              <div className="stat-item">
                <span className="stat-value">{progress.queued || 0}</span>
                <span className="stat-label">Queued</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{progress.processing || 0}</span>
                <span className="stat-label">Processing</span>
              </div>
            </>
          )}
        </div>
      </div>
      
      <div className="setting-group">
        <label className="setting-label">Data Location</label>
        <div className="path-display">
          <span className="path-text">{dataPath}</span>
          <button 
            className="icon-button"
            onClick={onOpenDataPath}
            title="Reveal in Finder"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 3.5C1 2.67 1.67 2 2.5 2h4.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 0010.621 4H13.5c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-11c-.83 0-1.5-.67-1.5-1.5v-9z"/>
            </svg>
          </button>
        </div>
      </div>
      
      <div className="actions-group">
        <button 
          onClick={onPauseResume} 
          className={`secondary-button ${progress?.paused ? 'paused' : ''}`}
        >
          {progress?.paused ? <><Icon icon={Play} size={16} /> Resume Indexing</> : <><Icon icon={Pause} size={16} /> Pause Indexing</>}
        </button>
        <button 
          onClick={onReindex} 
          className="secondary-button danger" 
          disabled={reindexing}
        >
          {reindexing ? 'Re-indexing...' : <><Icon icon={RefreshCw} size={16} /> Re-index All Documents</>}
        </button>
      </div>
      
      <div className="info-box">
        <p><strong>Re-indexing</strong> will clear all existing indexes and start fresh. This is useful if you've updated parser settings or want to ensure all documents are processed with the latest version.</p>
      </div>
    </div>
  );
}

export default IndexingSettings;