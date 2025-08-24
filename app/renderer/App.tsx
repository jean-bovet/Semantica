import React, { useState, useEffect } from 'react';
import SearchView from './components/SearchView';
import SettingsView from './components/SettingsView';
import StatusBar from './components/StatusBar';
import { SearchProvider } from './contexts/SearchContext';
import './App.css';

declare global {
  interface Window {
    api: import('../electron/preload').API;
  }
}

function App() {
  const [activeView, setActiveView] = useState<'search' | 'settings'>('search');
  const [indexProgress, setIndexProgress] = useState({
    queued: 0,
    processing: 0,
    done: 0,
    errors: 0,
    paused: false
  });
  
  useEffect(() => {
    const unsubscribe = window.api.indexer.onProgress(setIndexProgress);
    
    const interval = setInterval(async () => {
      const progress = await window.api.indexer.progress();
      setIndexProgress(progress);
    }, 2000);
    
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);
  
  return (
    <SearchProvider>
      <div className="app">
        <div className="sidebar">
          <div className="nav">
            <button
              className={`nav-item ${activeView === 'search' ? 'active' : ''}`}
              onClick={() => setActiveView('search')}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2"/>
                <path d="M14 14L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              Search
            </button>
            <button
              className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveView('settings')}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="2"/>
                <path d="M10 1V5M10 15V19M1 10H5M15 10H19" stroke="currentColor" strokeWidth="2"/>
              </svg>
              Settings
            </button>
          </div>
        </div>
        
        <div className="main">
          {activeView === 'search' ? (
            <SearchView />
          ) : (
            <SettingsView />
          )}
        </div>
        
        <StatusBar progress={indexProgress} />
      </div>
    </SearchProvider>
  );
}

export default App;