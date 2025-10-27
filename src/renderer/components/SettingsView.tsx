import React, { useState, useEffect } from 'react';
import { PARSER_INFO, ParserKey } from '../../shared/parserRegistry';
import SettingsSidebar, { SettingsSection } from './settings/SettingsSidebar';
import FoldersSettings from './settings/FoldersSettings';
import FileTypesSettings from './settings/FileTypesSettings';
import IndexingSettings from './settings/IndexingSettings';
import UpdatesSettings from './settings/UpdatesSettings';
import AboutSettings from './settings/AboutSettings';
import './SettingsView.css';

function SettingsView() {
  const [activeSection, setActiveSection] = useState<SettingsSection>('folders');
  const [folders, setFolders] = useState<string[]>([]);
  const [stats, setStats] = useState({ 
    totalChunks: 0, 
    indexedFiles: 0,
    folderStats: [] as Array<{ folder: string; totalFiles: number; indexedFiles: number }>
  });
  const [fileTypes, setFileTypes] = useState<Record<ParserKey, boolean>>(
    Object.keys(PARSER_INFO).reduce((acc, key) => {
      acc[key as ParserKey] = PARSER_INFO[key as ParserKey].enabledByDefault;
      return acc;
    }, {} as Record<ParserKey, boolean>)
  );
  const [reindexing, setReindexing] = useState(false);
  const [progress, setProgress] = useState<any>(null);
  const [dataPath, setDataPath] = useState<string>('');
  const [appVersion, setAppVersion] = useState<string>('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  
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
          console.log('[UI] Calling getWatchedFolders...');
          const currentFolders = await window.api.indexer.getWatchedFolders();
          console.log('[UI] getWatchedFolders returned:', currentFolders);
          console.log('[UI] Type:', typeof currentFolders, 'Is array:', Array.isArray(currentFolders), 'Length:', currentFolders?.length);

          if (currentFolders && currentFolders.length > 0) {
            console.log('[UI] Setting folders state to:', currentFolders);
            setFolders(currentFolders);
          } else {
            console.log('[UI] NOT setting folders state - currentFolders is empty or falsy');
          }
        } catch (e) {
          console.error('[UI] Failed to get watched folders:', e);
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
    
    // Get app version
    window.api.updater?.getVersion?.().then(version => {
      setAppVersion(version || '');
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
      
      // Start watching the new folders
      await window.api.indexer.watchStart(newFolders);
      
      // Wait a bit for the worker to process the change
      setTimeout(loadStats, 1000);
    }
  };
  
  const handleRemoveFolder = async (folderToRemove: string) => {
    const confirmed = await window.api.dialog.confirm(
      'Remove Folder',
      `Are you sure you want to remove "${folderToRemove}" from indexing? This will delete all indexed data for this folder.`
    );
    
    if (!confirmed) return;
    
    const newFolders = folders.filter(f => f !== folderToRemove);
    setFolders(newFolders);
    
    // Update the worker's watched folders
    await window.api.indexer.watchStart(newFolders);
    
    // Wait a bit for the worker to process the change
    setTimeout(loadStats, 1000);
  };
  
  const handlePauseResume = async () => {
    if (progress?.paused) {
      await window.api.indexer.resume();
    } else {
      await window.api.indexer.pause();
    }
  };
  
  const handleReindex = async () => {
    const confirmed = await window.api.dialog.confirm(
      'Re-index All Documents',
      'This will clear all existing indexes and re-process all documents. This may take some time depending on the number of files. Continue?'
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

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const result = await window.api.updater?.checkForUpdates?.();
      if (result?.available) {
        await window.api.dialog.error('Update Available', 
          `Version ${result.version} is available and will be downloaded in the background.`);
      } else {
        await window.api.dialog.error('No Updates', 
          'You are running the latest version of Semantica.');
      }
    } catch (error) {
      console.error('Update check failed:', error);
      await window.api.dialog.error('Update Check Failed', 
        'Failed to check for updates. Please check your internet connection and try again.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleOpenDataPath = () => {
    window.api.system.openPath(dataPath);
  };

  const renderSection = () => {
    switch (activeSection) {
      case 'folders':
        return (
          <FoldersSettings
            folders={folders}
            folderStats={stats.folderStats}
            onAddFolders={handleAddFolders}
            onRemoveFolder={handleRemoveFolder}
          />
        );
      case 'filetypes':
        return (
          <FileTypesSettings
            fileTypes={fileTypes}
            onFileTypesChange={handleFileTypesChange}
          />
        );
      case 'indexing':
        return (
          <IndexingSettings
            stats={stats}
            progress={progress}
            reindexing={reindexing}
            dataPath={dataPath}
            onPauseResume={handlePauseResume}
            onReindex={handleReindex}
            onOpenDataPath={handleOpenDataPath}
          />
        );
      case 'updates':
        return (
          <UpdatesSettings
            appVersion={appVersion}
            checkingUpdate={checkingUpdate}
            onCheckForUpdates={handleCheckForUpdates}
          />
        );
      case 'about':
        return <AboutSettings appVersion={appVersion} />;
      default:
        return null;
    }
  };

  return (
    <div className="settings-container">
      <SettingsSidebar 
        activeSection={activeSection} 
        onSectionChange={setActiveSection} 
      />
      <div className="settings-content">
        {renderSection()}
      </div>
    </div>
  );
}

export default SettingsView;