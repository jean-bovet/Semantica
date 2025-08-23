import React, { useState, useEffect } from 'react';
import './SettingsView.css';

function SettingsView() {
  const [folders, setFolders] = useState<string[]>([]);
  const [cpuThrottle, setCpuThrottle] = useState<'low' | 'medium' | 'high'>('medium');
  const [stats, setStats] = useState({ totalChunks: 0, indexedFiles: 0 });
  
  useEffect(() => {
    loadStats();
  }, []);
  
  const loadStats = async () => {
    const dbStats = await window.api.db.stats();
    setStats(dbStats);
  };
  
  const handleAddFolders = async () => {
    const selectedFolders = await window.api.dialog.selectFolders();
    if (selectedFolders.length > 0) {
      const newFolders = [...new Set([...folders, ...selectedFolders])];
      setFolders(newFolders);
      await window.api.indexer.watchStart(newFolders);
      setTimeout(loadStats, 2000);
    }
  };
  
  const handleRemoveFolder = async (folder: string) => {
    const newFolders = folders.filter(f => f !== folder);
    setFolders(newFolders);
    if (newFolders.length > 0) {
      await window.api.indexer.watchStart(newFolders);
    }
    setTimeout(loadStats, 2000);
  };
  
  const handlePauseResume = async () => {
    const progress = await window.api.indexer.progress();
    if (progress.paused) {
      await window.api.indexer.resume();
    } else {
      await window.api.indexer.pause();
    }
  };
  
  return (
    <div className="settings-view">
      <h2>Settings</h2>
      
      <section className="settings-section">
        <h3>Indexed Folders</h3>
        <div className="folder-list">
          {folders.map(folder => (
            <div key={folder} className="folder-item">
              <span className="folder-path">{folder}</span>
              <button 
                onClick={() => handleRemoveFolder(folder)}
                className="remove-button"
              >
                Remove
              </button>
            </div>
          ))}
          {folders.length === 0 && (
            <p className="empty-state">No folders indexed yet</p>
          )}
        </div>
        <button onClick={handleAddFolders} className="add-folder-button">
          Add Folders
        </button>
      </section>
      
      <section className="settings-section">
        <h3>Performance</h3>
        <div className="setting-item">
          <label>CPU Usage</label>
          <select 
            value={cpuThrottle} 
            onChange={(e) => setCpuThrottle(e.target.value as any)}
            className="throttle-select"
          >
            <option value="low">Low (Slower indexing)</option>
            <option value="medium">Medium (Balanced)</option>
            <option value="high">High (Faster indexing)</option>
          </select>
        </div>
      </section>
      
      <section className="settings-section">
        <h3>Index Statistics</h3>
        <div className="stats">
          <div className="stat-item">
            <span className="stat-label">Indexed Files:</span>
            <span className="stat-value">{stats.indexedFiles.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Total Chunks:</span>
            <span className="stat-value">{stats.totalChunks.toLocaleString()}</span>
          </div>
        </div>
      </section>
      
      <section className="settings-section">
        <h3>Indexing Control</h3>
        <button onClick={handlePauseResume} className="control-button">
          Pause/Resume Indexing
        </button>
      </section>
      
      <section className="settings-section">
        <h3>Privacy</h3>
        <div className="privacy-notice">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="green">
            <path d="M10 2L3 7V11C3 15.5 6.5 18 10 18C13.5 18 17 15.5 17 11V7L10 2Z" />
          </svg>
          <span>All processing happens on your device. No data leaves your Mac.</span>
        </div>
      </section>
    </div>
  );
}

export default SettingsView;