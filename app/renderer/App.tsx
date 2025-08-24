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
    api: import('../electron/preload').API;
  }
}

function App() {
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
      <div className="app">
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
    </SearchProvider>
  );
}

export default App;