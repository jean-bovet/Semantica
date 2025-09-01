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
  const [modelReady, setModelReady] = useState(false);
  const [checkingModel, setCheckingModel] = useState(true);
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadFile, setDownloadFile] = useState('');
  const [modelError, setModelError] = useState<string | null>(null);
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
    // Check if model exists and download if needed
    const initModel = async () => {
      try {
        // Small delay to ensure worker is ready
        await new Promise(resolve => setTimeout(resolve, 500));
        const result = await window.api.model.check();
        
        if (result && result.exists) {
          setModelReady(true);
          setCheckingModel(false);
        } else {
          // Model doesn't exist, start download
          setCheckingModel(false);
          setDownloadingModel(true);
          
          // Listen for download progress
          const handleProgress = (_: any, data: any) => {
            setDownloadProgress(data.progress || 0);
            setDownloadFile(data.file || '');
          };
          
          const handleComplete = () => {
            setDownloadingModel(false);
            setModelReady(true);
          };
          
          window.api.on('model:download:progress', handleProgress);
          window.api.on('model:download:complete', handleComplete);
          
          // Start download
          try {
            await window.api.model.download();
          } catch (_downloadErr: any) {
            setModelError('Failed to download model. Please check your internet connection.');
            setDownloadingModel(false);
          }
          
          // Cleanup listeners
          return () => {
            window.api.off('model:download:progress', handleProgress);
            window.api.off('model:download:complete', handleComplete);
          };
        }
      } catch (_err) {
        // Retry once
        setTimeout(async () => {
          try {
            const result = await window.api.model.check();
            if (result && result.exists) {
              setModelReady(true);
            } else {
              setModelError('Failed to initialize. Please restart the app.');
            }
          } catch (_retryErr) {
            setModelError('Failed to initialize AI model.');
          }
          setCheckingModel(false);
        }, 1000);
      }
    };
    
    initModel();
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
        
        {/* Simple loading overlay */}
        {(checkingModel || downloadingModel || !modelReady) && (
          <div style={{
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
              {checkingModel ? (
                <>
                  <div style={{
                    width: 40,
                    height: 40,
                    border: '3px solid #444',
                    borderTopColor: '#3B82F6',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    margin: '0 auto 16px'
                  }} />
                  <p style={{ color: '#9CA3AF', fontSize: 14 }}>Loading...</p>
                </>
              ) : downloadingModel ? (
                <div style={{ 
                  backgroundColor: '#1F2937',
                  padding: 32,
                  borderRadius: 12,
                  minWidth: 400
                }}>
                  <h3 style={{ color: 'white', marginBottom: 8, fontSize: 18 }}>
                    Downloading AI Model
                  </h3>
                  
                  {downloadFile && (
                    <p style={{ 
                      color: '#60A5FA', 
                      fontSize: 12, 
                      marginBottom: 16,
                      fontFamily: 'monospace'
                    }}>
                      {downloadFile.split('/').pop()}
                    </p>
                  )}
                  
                  <div style={{
                    width: '100%',
                    height: 8,
                    backgroundColor: '#374151',
                    borderRadius: 4,
                    overflow: 'hidden',
                    marginBottom: 8
                  }}>
                    <div style={{
                      width: `${downloadProgress}%`,
                      height: '100%',
                      backgroundColor: '#3B82F6',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                  
                  <p style={{ color: '#9CA3AF', fontSize: 14 }}>
                    {Math.round(downloadProgress)}%
                  </p>
                </div>
              ) : modelError ? (
                <div style={{ 
                  backgroundColor: '#1F2937',
                  padding: 24,
                  borderRadius: 12,
                  maxWidth: 400
                }}>
                  <p style={{ color: '#EF4444', marginBottom: 16 }}>{modelError}</p>
                  <button 
                    onClick={() => window.location.reload()}
                    style={{
                      backgroundColor: '#3B82F6',
                      color: 'white',
                      padding: '8px 24px',
                      borderRadius: 8,
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    Retry
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </SearchProvider>
  );
}

export default App;