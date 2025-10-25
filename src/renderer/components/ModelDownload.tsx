import React, { useEffect, useState } from 'react';

interface ModelDownloadProps {
  onComplete: () => void;
}

type StartupStage = 'checking' | 'downloading' | 'initializing' | 'ready' | 'error';

interface StartupStageMessage {
  stage: StartupStage;
  message?: string;
  progress?: number;
}

interface StartupErrorMessage {
  code: string;
  message: string;
}

const ModelDownload: React.FC<ModelDownloadProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<StartupStage>('checking');
  const [stageMessage, setStageMessage] = useState('Initializing...');
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState('');
  const [bytesLoaded, setBytesLoaded] = useState(0);
  const [bytesTotal, setBytesTotal] = useState(0);
  const [error, setError] = useState<StartupErrorMessage | null>(null);

  useEffect(() => {
    let mounted = true;

    // Listen for startup stage events
    const handleStage = (_: any, data: StartupStageMessage) => {
      if (!mounted) return;
      setStage(data.stage);
      setStageMessage(data.message || '');
      if (data.progress !== undefined) {
        setProgress(data.progress);
      }

      // Complete when ready
      if (data.stage === 'ready') {
        onComplete();
      }
    };

    // Listen for startup errors
    const handleError = (_: any, data: StartupErrorMessage) => {
      if (!mounted) return;
      setStage('error');
      setError(data);
    };

    // Listen for download progress (for file details)
    const handleProgress = (_: any, data: any) => {
      if (!mounted) return;
      setProgress(data.progress || 0);
      setCurrentFile(data.file || '');
      setBytesLoaded(data.loaded || 0);
      setBytesTotal(data.total || 0);
    };

    // Listen for app:ready as backup
    const handleReady = () => {
      if (!mounted) return;
      onComplete();
    };

    window.api.on('startup:stage', handleStage);
    window.api.on('startup:error', handleError);
    window.api.on('model:download:progress', handleProgress);
    window.api.on('app:ready', handleReady);

    return () => {
      mounted = false;
      window.api.off('startup:stage', handleStage);
      window.api.off('startup:error', handleError);
      window.api.off('model:download:progress', handleProgress);
      window.api.off('app:ready', handleReady);
    };
  }, [onComplete]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileName = (path: string): string => {
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
  };

  const handleRetry = async () => {
    setError(null);
    setStage('checking');
    setStageMessage('Retrying...');
    try {
      await window.api.invoke('startup:retry');
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  // Error state
  if (error) {
    const isOllamaNotFound = error.code === 'OLLAMA_NOT_FOUND';

    return (
      <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="bg-gray-800/90 backdrop-blur-sm rounded-2xl p-10 max-w-md w-full mx-4 shadow-2xl border border-gray-700">
          <div className="flex items-center mb-6">
            <div className="bg-red-500/20 p-3 rounded-full mr-4">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white">
              {isOllamaNotFound ? 'Ollama Required' : 'Initialization Error'}
            </h2>
          </div>
          <p className="text-gray-300 mb-8 leading-relaxed">{error.message}</p>
          {isOllamaNotFound ? (
            <div className="space-y-3">
              <button
                onClick={() => window.open('https://ollama.com/download')}
                className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                Open Ollama Website
              </button>
              <button
                onClick={handleRetry}
                className="w-full px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-all duration-200"
              >
                Retry
              </button>
            </div>
          ) : (
            <button
              onClick={handleRetry}
              className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // Checking/Initializing state
  if (stage === 'checking' || stage === 'initializing') {
    return (
      <div className="fixed inset-0 bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4">
            <div className="w-full h-full border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin"></div>
          </div>
          <p className="text-gray-400 text-sm">{stageMessage || 'Loading...'}</p>
        </div>
      </div>
    );
  }

  // Downloading state
  if (stage === 'downloading') {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="bg-gray-800/90 backdrop-blur-sm rounded-2xl p-10 max-w-lg w-full mx-4 shadow-2xl border border-gray-700">
          <div className="flex items-center mb-6">
            <div className="bg-blue-500/20 p-3 rounded-full mr-4">
              <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">
                Downloading Embedding Model
              </h2>
              <p className="text-gray-400 text-sm">
                bge-m3 multilingual model
              </p>
            </div>
          </div>

          {currentFile && (
            <div className="bg-gray-900/50 rounded-lg px-4 py-2 mb-4">
              <p className="text-blue-400 text-sm font-mono">
                {getFileName(currentFile)}
              </p>
            </div>
          )}

          <div className="space-y-2 mb-6">
            <div className="relative">
              <div className="overflow-hidden h-4 bg-gray-700/50 rounded-full">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500 ease-out shadow-lg shadow-blue-500/20"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-white font-medium">{Math.round(progress)}%</span>
              {bytesTotal > 0 && (
                <span className="text-gray-400">
                  {formatBytes(bytesLoaded)} / {formatBytes(bytesTotal)}
                </span>
              )}
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <p className="text-blue-300 text-sm text-center">
              <svg className="w-4 h-4 inline mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              This is a one-time download (~2GB)
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default ModelDownload;
