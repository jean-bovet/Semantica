import React, { useEffect, useState } from 'react';
import {
  STARTUP_STEPS,
  getStepStatus,
  getStageMessage,
  type StartupStage,
  type StepStatus
} from '../utils/StepperLogic';

interface StartupProgressProps {
  onComplete: () => void;
}

interface StartupStageMessage {
  stage: StartupStage;
  message?: string;
  progress?: number;
}

interface StartupErrorMessage {
  code: string;
  message: string;
}

const StartupProgress: React.FC<StartupProgressProps> = ({ onComplete }) => {
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
      await window.api.startup.retry();
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

  // Render step icon based on status
  const renderStepIcon = (status: StepStatus) => {
    switch (status) {
      case 'completed':
        return (
          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        );
      case 'active':
        return (
          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
          </div>
        );
      case 'error':
        return (
          <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        );
      case 'pending':
      default:
        return (
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-gray-600"></div>
          </div>
        );
    }
  };

  // Normal loading state (not error)
  if (stage !== 'error') {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="bg-gray-800/90 backdrop-blur-sm rounded-2xl p-10 max-w-md w-full mx-4 shadow-2xl border border-gray-700">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-white mb-2">
              Initializing Semantica
            </h2>
            <p className="text-gray-400 text-sm">
              {getStageMessage(stage, stageMessage)}
            </p>
          </div>

          <div className="space-y-4">
            {STARTUP_STEPS.map((step, index) => {
              const status = getStepStatus(stage, index, false);
              const isLast = index === STARTUP_STEPS.length - 1;

              return (
                <div key={step.id} className="relative">
                  <div className="flex items-center">
                    {renderStepIcon(status)}
                    <div className="ml-4 flex-1">
                      <p className={`text-sm font-medium ${
                        status === 'active' ? 'text-white' :
                        status === 'completed' ? 'text-green-400' :
                        status === 'error' ? 'text-red-400' :
                        'text-gray-500'
                      }`}>
                        {step.label}
                      </p>
                    </div>
                  </div>
                  {!isLast && (
                    <div className="ml-4 mt-2 mb-2 w-0.5 h-6 bg-gray-700"></div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default StartupProgress;
