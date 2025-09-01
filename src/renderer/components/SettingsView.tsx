import React, { useState, useEffect } from 'react';
import MultiSelectDropdown from './MultiSelectDropdown';
import { PARSER_INFO, getFileTypeOptions, ParserKey } from '../../shared/parserRegistry';
import './SettingsView.css';

function SettingsView() {
  const [folders, setFolders] = useState<string[]>([]);
  const [stats, setStats] = useState({ 
    totalChunks: 0, 
    indexedFiles: 0,
    folderStats: [] as Array<{ folder: string; totalFiles: number; indexedFiles: number }>
  });
  // Initialize file types from registry
  const [fileTypes, setFileTypes] = useState<Record<ParserKey, boolean>>(
    Object.keys(PARSER_INFO).reduce((acc, key) => {
      acc[key as ParserKey] = PARSER_INFO[key as ParserKey].enabledByDefault;
      return acc;
    }, {} as Record<ParserKey, boolean>)
  );
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
    // Get folder stats to show in confirmation
    const folderStat = stats.folderStats?.find(s => s.folder === folder);
    const fileCount = folderStat ? folderStat.indexedFiles : 0;
    
    const confirmed = await window.api.dialog.confirm(
      'Remove Folder',
      `Are you sure you want to remove "${folder}" from indexing?\n\nThis will permanently delete ${fileCount.toLocaleString()} indexed file${fileCount !== 1 ? 's' : ''} from this folder. This action cannot be undone.`
    );
    
    if (!confirmed) return;
    
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
  
  // Generate file type options from registry
  const fileTypeOptions = getFileTypeOptions();

  const selectedFileTypes = Object.entries(fileTypes)
    .filter(([_, enabled]) => enabled)
    .map(([type]) => type);

  const handleFileTypesChange = async (selected: string[]) => {
    // Generate file types object from selected array
    const newFileTypes = Object.keys(PARSER_INFO).reduce((acc, key) => {
      acc[key as ParserKey] = selected.includes(key);
      return acc;
    }, {} as Record<ParserKey, boolean>);
    
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