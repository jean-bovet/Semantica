import React, { useState, useEffect } from 'react';
import MultiSelectDropdown from './MultiSelectDropdown';
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
  const [reindexing, setReindexing] = useState(false);
  const [progress, setProgress] = useState<any>(null);
  const [dataPath, setDataPath] = useState<string>('');
  
  useEffect(() => {
    // Set up periodic stats refresh
    const interval = setInterval(loadStats, 5000);
    
    // Listen for regular indexing progress
    const unsubscribe = window.api.indexer.onProgress((newProgress) => {
      setProgress(newProgress);
      // If re-indexing and queue is empty, it's done
      if (reindexing && newProgress.queued === 0 && newProgress.processing === 0) {
        setReindexing(false);
        loadStats();
      }
    });
    
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
    
    // Get data path
    window.api.system.getDataPath?.().then(path => {
      setDataPath(path || '~/Library/Application Support/Semantica/data/');
    });
    
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
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
    if (progress?.paused) {
      await window.api.indexer.resume();
    } else {
      await window.api.indexer.pause();
    }
    // Update progress state immediately after action
    const newProgress = await window.api.indexer.progress();
    setProgress(newProgress);
  };
  
  const handleReindex = async () => {
    if (reindexing) return;
    
    const confirmed = await window.api.dialog.confirm(
      'Re-index All Documents',
      'This will delete the current index and re-index all documents with the new multilingual model. This process may take some time depending on the number of files. Continue?'
    );
    
    if (!confirmed) return;
    
    setReindexing(true);
    
    try {
      // Start re-indexing (uses normal indexing progress)
      await window.api.indexer.reindexAll();
      // Progress will be tracked through normal indexer progress
    } catch (error) {
      console.error('Re-indexing failed:', error);
      setReindexing(false);
      await window.api.dialog.error('Re-indexing Failed', 'An error occurred while re-indexing. Please try again.');
    }
  };
  
  const fileTypeOptions = [
    { value: 'pdf', label: 'PDF' },
    { value: 'txt', label: 'TXT' },
    { value: 'md', label: 'MD' },
    { value: 'docx', label: 'DOCX' },
    { value: 'rtf', label: 'RTF' },
    { value: 'doc', label: 'DOC' }
  ];

  const selectedFileTypes = Object.entries(fileTypes)
    .filter(([_, enabled]) => enabled)
    .map(([type]) => type);

  const handleFileTypesChange = async (selected: string[]) => {
    const newFileTypes = {
      pdf: selected.includes('pdf'),
      txt: selected.includes('txt'),
      md: selected.includes('md'),
      docx: selected.includes('docx'),
      rtf: selected.includes('rtf'),
      doc: selected.includes('doc')
    };
    setFileTypes(newFileTypes);
    
    try {
      await window.api.settings.update({ fileTypes: newFileTypes });
    } catch (e) {
      console.error('Failed to update file type settings:', e);
    }
  };

  return (
    <div className="settings-view">
      <div className="settings-group">
        <h3 className="settings-subtitle">Indexed Folders</h3>
        <div className="folder-list compact">
          {folders.map(folder => {
            const folderStat = stats.folderStats?.find(s => s.folder === folder);
            return (
              <div key={folder} className="folder-item compact">
                <span className="folder-path">{folder}</span>
                <span className="folder-stats">
                  {folderStat ? `${folderStat.indexedFiles} / ${folderStat.totalFiles} files` : 'Loading...'}
                </span>
                <button 
                  onClick={() => handleRemoveFolder(folder)}
                  className="remove-button compact"
                  title="Remove folder"
                >
                  ×
                </button>
              </div>
            );
          })}
          {folders.length === 0 && (
            <p className="empty-state">No folders indexed yet</p>
          )}
        </div>
        <button onClick={handleAddFolders} className="add-folder-button compact">
          + Add Folders
        </button>
      </div>
      
      <div className="settings-group">
        <h3 className="settings-subtitle">Configuration</h3>
        <div className="config-row">
          <label className="config-label">File Types:</label>
          <MultiSelectDropdown
            options={fileTypeOptions}
            selected={selectedFileTypes}
            onChange={handleFileTypesChange}
            placeholder="Select file types"
          />
        </div>
        <div className="config-row">
          <label className="config-label">CPU Usage:</label>
          <select 
            value={cpuThrottle} 
            onChange={(e) => setCpuThrottle(e.target.value as any)}
            className="throttle-select compact"
          >
            <option value="low">Low (Slower indexing)</option>
            <option value="medium">Medium (Balanced)</option>
            <option value="high">High (Faster indexing)</option>
          </select>
        </div>
      </div>
      
      <div className="settings-group">
        <h3 className="settings-subtitle">Statistics</h3>
        <div className="stats-container">
          <div className="stats-line">
            <span>{stats.indexedFiles.toLocaleString()} files indexed</span>
            <span className="stats-separator">|</span>
            <span>{stats.totalChunks.toLocaleString()} chunks</span>
          </div>
          <div className="stats-path-row">
            <span className="stats-path">{dataPath}</span>
            <button 
              className="reveal-button"
              onClick={() => window.api.system.openPath(dataPath)}
              title="Reveal in Finder"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 3.5C1 2.67 1.67 2 2.5 2h4.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 0010.621 4H13.5c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-11c-.83 0-1.5-.67-1.5-1.5v-9z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      
      <div className="settings-actions">
        <button 
          onClick={handlePauseResume} 
          className={`action-button ${progress?.paused ? 'paused' : ''}`}
        >
          {progress?.paused ? 'Resume Indexing' : 'Pause Indexing'}
        </button>
        <button onClick={handleReindex} className="action-button" disabled={reindexing}>
          {reindexing ? 'Re-indexing...' : 'Re-index All Documents'}
        </button>
      </div>
      
      <div className="privacy-footer">
        <span>🔒 All processing happens locally</span>
      </div>
    </div>
  );
}

export default SettingsView;