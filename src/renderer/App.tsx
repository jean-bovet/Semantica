import React, { useState, useEffect, useCallback } from 'react';
import SearchView from './components/SearchView';
import SettingsView from './components/SettingsView';
import StatusBar from './components/StatusBar';
import Modal from './components/Modal';
import FileSearchModal from './components/FileSearchModal';
import StartupProgress from './components/StartupProgress';
import { SearchProvider } from './contexts/SearchContext';
import { normalizeProgress } from './utils/statusHelpers';
import './App.css';

declare global {
  interface Window {
    api: import('../main/preload').API;
  }
}

function App() {
  const [appReady, setAppReady] = useState(false);
  const [_filesLoaded, setFilesLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [indexProgress, setIndexProgress] = useState({
    queued: 0,
    processing: 0,
    done: 0,
    errors: 0,
    paused: false,
    initialized: false
  });

  // Memoized callback to prevent re-creating on every render
  const handleStartupComplete = useCallback(() => {
    setAppReady(true);
  }, []);

  // Listen for files loaded event
  useEffect(() => {
    // Check if indexer is already initialized (happens during hot-reload)
    const checkInitialState = async () => {
      try {
        const progress = await window.api.indexer.progress();
        if (progress?.initialized) {
          setFilesLoaded(true);
        }
      } catch (err) {
        console.error('Failed to check indexer state:', err);
      }
    };
    
    checkInitialState();
    
    const handleFilesLoaded = () => {
      setFilesLoaded(true);
    };
    
    window.api.on('files:loaded', handleFilesLoaded);
    
    return () => {
      window.api.off('files:loaded', handleFilesLoaded);
    };
  }, []);
  
  
  useEffect(() => {
    const unsubscribe = window.api.indexer.onProgress((progress) => {
      setIndexProgress(normalizeProgress(progress));
    });
    
    const interval = setInterval(async () => {
      const progress = await window.api.indexer.progress();
      setIndexProgress(normalizeProgress(progress));
    }, 2000);
    
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  return (
    <SearchProvider>
      <div className="app" data-testid="app-ready">
        <div className="main-content">
          <SearchView />
        </div>

        <StatusBar
          progress={indexProgress}
          onSettingsClick={() => setShowSettings(true)}
          onFileSearchClick={() => setShowFileSearch(true)}
        />

        <Modal
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          title="Settings"
        >
          <SettingsView />
        </Modal>

        <FileSearchModal
          isOpen={showFileSearch}
          onClose={() => setShowFileSearch(false)}
        />
      </div>

      {/* Startup progress overlay - rendered outside .app to avoid flex container issues */}
      {!appReady && (
        <StartupProgress onComplete={handleStartupComplete} />
      )}
    </SearchProvider>
  );
}

export default App;