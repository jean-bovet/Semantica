import React, { useState, useEffect } from 'react';
import SearchView from './components/SearchView';
import SettingsView from './components/SettingsView';
import StatusBar from './components/StatusBar';
import Modal from './components/Modal';
import FileSearchModal from './components/FileSearchModal';
import { SearchProvider } from './contexts/SearchContext';
import { normalizeProgress } from './utils/statusHelpers';
import './App.css';

declare global {
  interface Window {
    api: import('../main/preload').API;
  }
}

function App() {
  const [appReady, setAppReady] = useState(() =>
    sessionStorage.getItem('appReady') === 'true'
  );
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
  
  // Listen for app ready event
  useEffect(() => {
    const handleAppReady = () => {
      setAppReady(true);
      sessionStorage.setItem('appReady', 'true');
    };

    window.api.on('app:ready', handleAppReady);

    return () => {
      window.api.off('app:ready', handleAppReady);
    };
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
        
        {/* Simple loading overlay */}
        {!appReady && (
          <div data-testid="loading-indicator" style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 40,
                height: 40,
                border: '3px solid #444',
                borderTopColor: '#3B82F6',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 16px'
              }} />
              <p style={{ color: '#9CA3AF', fontSize: 14 }}>
                Initializing...
              </p>
            </div>
          </div>
        )}
      </div>
    </SearchProvider>
  );
}

export default App;