import React, { useEffect, useState } from 'react';
import {
  STARTUP_STEPS,
  getStepStatus,
  getStageMessage,
  type StartupStage,
  type StepStatus
} from '../utils/StepperLogic';
import './StartupProgress.css';

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
  // DEBUG: Check if component is mounting
  console.log('[StartupProgress] COMPONENT MOUNTED');

  const [stage, setStage] = useState<StartupStage>('worker_spawn');
  const [stageMessage, setStageMessage] = useState('Initializing...');
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState('');
  const [bytesLoaded, setBytesLoaded] = useState(0);
  const [bytesTotal, setBytesTotal] = useState(0);
  const [error, setError] = useState<StartupErrorMessage | null>(null);

  // DEBUG: Check render state
  console.log('[StartupProgress] Rendering - stage:', stage, 'error:', error);

  useEffect(() => {
    let mounted = true;

    // Listen for startup stage events
    const handleStage = (_: any, data: StartupStageMessage) => {
      if (!mounted) return;
      console.log('[StartupProgress] Received stage event:', data.stage, 'message:', data.message);
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
      <div className="startup-error-overlay">
        <div className="startup-error-card">
          <div className="startup-error-header">
            <div className="startup-error-icon">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="startup-error-title">
              {isOllamaNotFound ? 'Ollama Required' : 'Initialization Error'}
            </h2>
          </div>
          <p className="startup-error-message">{error.message}</p>
          {isOllamaNotFound ? (
            <div className="startup-error-actions">
              <button
                onClick={() => window.open('https://ollama.com/download')}
                className="startup-error-button primary"
              >
                Open Ollama Website
              </button>
              <button
                onClick={handleRetry}
                className="startup-error-button secondary"
              >
                Retry
              </button>
            </div>
          ) : (
            <button
              onClick={handleRetry}
              className="startup-error-button primary"
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
          <div className={`startup-step-icon ${status}`}>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        );
      case 'active':
        return (
          <div className={`startup-step-icon ${status}`} />
        );
      case 'error':
        return (
          <div className={`startup-step-icon ${status}`}>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        );
      case 'pending':
      default:
        return (
          <div className={`startup-step-icon ${status}`}>
            <div className="step-dot"></div>
          </div>
        );
    }
  };

  // Normal loading state (not error)
  if (stage !== 'error') {
    return (
      <div className="startup-overlay">
        <div className="startup-card">
          <div className="startup-header">
            <h2 className="startup-title">Initializing Semantica</h2>
            <p className="startup-message">{getStageMessage(stage, stageMessage)}</p>
          </div>

          <div className="startup-steps">
            {STARTUP_STEPS.map((step, index) => {
              const status = getStepStatus(stage, index, false);
              const isLast = index === STARTUP_STEPS.length - 1;

              return (
                <div key={step.id} className="startup-step">
                  <div className="startup-step-content">
                    {renderStepIcon(status)}
                    <div className={`startup-step-label ${status}`}>
                      <p>{step.label}</p>
                    </div>
                  </div>
                  {!isLast && <div className="startup-step-connector"></div>}
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
