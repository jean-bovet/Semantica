import React, { useEffect, useState } from 'react';
import {
  getStageMessage,
  type StartupStage
} from '../utils/StepperLogic';
import { getStageIndex, STARTUP_STAGE_ORDER } from '../../shared/types/startup';
import type { StartupStageMessage, StartupErrorMessage } from '../../shared/types/startup';
import './StartupProgress.css';

interface StartupProgressProps {
  onComplete: () => void;
}

const StartupProgress: React.FC<StartupProgressProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<StartupStage>('worker_spawn');
  const [stageMessage, setStageMessage] = useState('Initializing...');
  const [error, setError] = useState<StartupErrorMessage | null>(null);

  useEffect(() => {
    let mounted = true;

    // Check if worker is already ready (e.g., after page reload)
    const checkWorkerReady = async () => {
      const isReady = await window.api.worker.isReady();
      if (isReady && mounted) {
        // Worker is already ready, complete immediately
        onComplete();
      }
    };
    checkWorkerReady();

    // Listen for startup stage events
    const handleStage = (_: any, data: StartupStageMessage) => {
      if (!mounted) return;

      setStage(data.stage);
      setStageMessage(data.message || '');

      // Delay completion to let user see "ready" stage
      if (data.stage === 'ready') {
        setTimeout(() => {
          if (mounted) {
            onComplete();
          }
        }, 400);
      }
    };

    // Listen for startup errors
    const handleError = (_: any, data: StartupErrorMessage) => {
      if (!mounted) return;
      setStage('error');
      setError(data);
    };

    window.api.on('startup:stage', handleStage);
    window.api.on('startup:error', handleError);

    return () => {
      mounted = false;
      window.api.off('startup:stage', handleStage);
      window.api.off('startup:error', handleError);
    };
  }, [onComplete]);

  const handleRetry = async () => {
    setError(null);
    setStage('sidecar_start');
    setStageMessage('Retrying...');
    try {
      await window.api.startup.retry();
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  // Error state
  if (error) {
    const isSidecarError = error.code === 'SIDECAR_START_FAILED' || error.code === 'SIDECAR_NOT_HEALTHY';
    const helpUrl = error.details && typeof error.details === 'object' && 'helpUrl' in error.details
      ? (error.details as any).helpUrl
      : null;

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
              {isSidecarError ? 'Embedding Service Error' : 'Initialization Error'}
            </h2>
          </div>
          <p className="startup-error-message">{error.message}</p>
          {helpUrl && (
            <p className="startup-error-help">
              See installation instructions:{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  window.api.system.openExternal(helpUrl);
                }}
                className="startup-error-link"
              >
                README.md
              </a>
            </p>
          )}
          <div className="startup-error-buttons">
            <button
              onClick={handleRetry}
              className="startup-error-button primary"
            >
              Retry
            </button>
            <button
              onClick={() => window.api.app.quit()}
              className="startup-error-button secondary"
            >
              Quit
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Calculate progress percentage based on current stage
  const calculateProgress = (): number => {
    const stageIdx = getStageIndex(stage);
    if (stageIdx === -1) return 0; // Error state
    const totalStages = STARTUP_STAGE_ORDER.length;
    return Math.round(((stageIdx + 1) / totalStages) * 100);
  };

  // Normal loading state (not error)
  if (stage !== 'error') {
    const progressPercentage = calculateProgress();

    return (
      <div className="startup-overlay">
        <div className="startup-card">
          <div className="startup-header">
            <h2 className="startup-title">Initializing Semantica</h2>
            <p className="startup-message">{getStageMessage(stage, stageMessage)}</p>
          </div>

          <div className="progress-container">
            <div
              className="progress-fill"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default StartupProgress;
