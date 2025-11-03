import React, { useState, useEffect, useCallback } from 'react';
import SearchView from './components/SearchView';
import SettingsView from './components/SettingsView';
import StatusBar from './components/StatusBar';
import Modal from './components/Modal';
import FileSearchModal from './components/FileSearchModal';
import StartupProgressInline from './components/StartupProgressInline';
import { SearchProvider } from './contexts/SearchContext';
import { normalizeProgress } from './utils/statusHelpers';
import './App.css';

declare global {
  interface Window {
    api: import('../main/preload').API;
  }
}

// Main interface component - only renders when app is ready
function MainInterface() {
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

  // Listen for files loaded event
  useEffect(() => {
    const handleFilesLoaded = () => {
      setFilesLoaded(true);
    };

    window.api.on('files:loaded', handleFilesLoaded);

    return () => {
      window.api.off('files:loaded', handleFilesLoaded);
    };
  }, []);

  // Poll for indexer progress
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
    <>
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
    </>
  );
}

function App() {
  const [appReady, setAppReady] = useState(false);

  // Memoized callback to prevent re-creating on every render
  const handleStartupComplete = useCallback(() => {
    setAppReady(true);
  }, []);

  return (
    <SearchProvider>
      <div className="app" data-testid="app-ready">
        {appReady ? (
          <MainInterface />
        ) : (
          <StartupProgressInline onComplete={handleStartupComplete} />
        )}
      </div>
    </SearchProvider>
  );
}

export default App;