import React, { useState, useEffect } from 'react';
import './SettingsView.css';

function SettingsView() {
  const [folders, setFolders] = useState<string[]>([]);
  const [cpuThrottle, setCpuThrottle] = useState<'low' | 'medium' | 'high'>('medium');
  const [stats, setStats] = useState({ 
    totalChunks: 0, 
    indexedFiles: 0,
    folderStats: [] as Array<{ folder: string; totalFiles: number; indexedFiles: number }>
  });
  const [fileTypes, setFileTypes] = useState({
    pdf: false,
    txt: true,
    md: true,
    docx: true,
    rtf: true,
    doc: true
  });
  
  useEffect(() => {
    // Set up periodic stats refresh
    const interval = setInterval(loadStats, 5000);
    
    const loadFolders = async () => {
      // Migrate from localStorage if exists (one-time migration)
      const savedInLocalStorage = localStorage.getItem('indexedFolders');
      if (savedInLocalStorage) {
        try {
          const parsedFolders = JSON.parse(savedInLocalStorage);
          if (parsedFolders.length > 0) {
            // Migrate to config and start watching
            await window.api.indexer.watchStart(parsedFolders);
            setFolders(parsedFolders);
          }
          // Clear localStorage after migration
          localStorage.removeItem('indexedFolders');
        } catch (e) {
          console.error('Failed to migrate folders from localStorage:', e);
        }
      } else {
        // Get folders from worker's persisted config
        try {
          const currentFolders = await window.api.indexer.getWatchedFolders();
          if (currentFolders && currentFolders.length > 0) {
            setFolders(currentFolders);
          }
        } catch (e) {
          console.error('Failed to get watched folders:', e);
        }
      }
    };
    
    loadFolders();
    loadStats();
    loadSettings();
    
    return () => clearInterval(interval);
  }, []);
  
  const loadSettings = async () => {
    try {
      const settings = await window.api.settings.get();
      if (settings?.fileTypes) {
        setFileTypes(settings.fileTypes);
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  };
  
  const toggleFileType = async (type: keyof typeof fileTypes) => {
    const newFileTypes = { ...fileTypes, [type]: !fileTypes[type] };
    setFileTypes(newFileTypes);
    
    try {
      await window.api.settings.update({ fileTypes: newFileTypes });
    } catch (e) {
      console.error('Failed to update file type settings:', e);
    }
  };
  
  const loadStats = async () => {
    const dbStats = await window.api.db.stats();
    setStats(dbStats);
  };
  
  const handleAddFolders = async () => {
    const selectedFolders = await window.api.dialog.selectFolders();
    if (selectedFolders.length > 0) {
      const newFolders = [...new Set([...folders, ...selectedFolders])];
      setFolders(newFolders);
      // Config is persisted by the worker
      await window.api.indexer.watchStart(newFolders);
      setTimeout(loadStats, 2000);
    }
  };
  
  const handleRemoveFolder = async (folder: string) => {
    const newFolders = folders.filter(f => f !== folder);
    setFolders(newFolders);
    // Config is persisted by the worker  
    await window.api.indexer.watchStart(newFolders);
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
          {folders.map(folder => {
            const folderStat = stats.folderStats?.find(s => s.folder === folder);
            return (
              <div key={folder} className="folder-item">
                <div className="folder-info">
                  <span className="folder-path">{folder}</span>
                  {folderStat && (
                    <span className="folder-count">
                      {folderStat.indexedFiles} indexed / {folderStat.totalFiles} total files
                    </span>
                  )}
                </div>
                <button 
                  onClick={() => handleRemoveFolder(folder)}
                  className="remove-button"
                >
                  Remove
                </button>
              </div>
            );
          })}
          {folders.length === 0 && (
            <p className="empty-state">No folders indexed yet</p>
          )}
        </div>
        <button onClick={handleAddFolders} className="add-folder-button">
          Add Folders
        </button>
      </section>
      
      <section className="settings-section">
        <h3>File Types</h3>
        <div className="file-types-grid">
          <div className="setting-item">
            <label className="file-type-toggle">
              <input 
                type="checkbox" 
                checked={fileTypes.pdf}
                onChange={() => toggleFileType('pdf')}
              />
              <span>PDF Files</span>
            </label>
          </div>
          <div className="setting-item">
            <label className="file-type-toggle">
              <input 
                type="checkbox" 
                checked={fileTypes.txt}
                onChange={() => toggleFileType('txt')}
              />
              <span>Text Files (.txt)</span>
            </label>
          </div>
          <div className="setting-item">
            <label className="file-type-toggle">
              <input 
                type="checkbox" 
                checked={fileTypes.md}
                onChange={() => toggleFileType('md')}
              />
              <span>Markdown Files (.md)</span>
            </label>
          </div>
          <div className="setting-item">
            <label className="file-type-toggle">
              <input 
                type="checkbox" 
                checked={fileTypes.docx}
                onChange={() => toggleFileType('docx')}
              />
              <span>Word Documents (.docx)</span>
            </label>
          </div>
          <div className="setting-item">
            <label className="file-type-toggle">
              <input 
                type="checkbox" 
                checked={fileTypes.rtf}
                onChange={() => toggleFileType('rtf')}
              />
              <span>Rich Text Files (.rtf)</span>
            </label>
          </div>
          <div className="setting-item">
            <label className="file-type-toggle">
              <input 
                type="checkbox" 
                checked={fileTypes.doc}
                onChange={() => toggleFileType('doc')}
              />
              <span>Legacy Word (.doc)</span>
            </label>
          </div>
        </div>
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
          <div className="stat-item">
            <span className="stat-label">Index Location:</span>
            <span className="stat-value" style={{ fontSize: '12px' }}>~/Library/Application Support/offline-mac-search/data/</span>
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