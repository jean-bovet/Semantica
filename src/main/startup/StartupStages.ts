export enum StartupStage {
  WORKER_SPAWN = 'worker_spawn',
  DB_INIT = 'db_init',
  DB_LOAD = 'db_load',
  MODEL_CHECK = 'model_check',
  MODEL_DOWNLOAD = 'model_download',
  EMBEDDER_INIT = 'embedder_init',
  FOLDER_SCAN = 'folder_scan',
  READY = 'ready'
}

export interface StageProgress {
  stage: StartupStage;
  message?: string;
  progress?: number; // 0-100 for stages with measurable progress
  timestamp: number;
}

export interface StageTimeout {
  stage: StartupStage;
  timeout: number; // milliseconds
}

export const STAGE_TIMEOUTS: StageTimeout[] = [
  { stage: StartupStage.WORKER_SPAWN, timeout: 10000 },
  { stage: StartupStage.DB_INIT, timeout: 10000 },
  { stage: StartupStage.DB_LOAD, timeout: 30000 }, // Can be slow with many files
  { stage: StartupStage.MODEL_CHECK, timeout: 10000 },
  { stage: StartupStage.MODEL_DOWNLOAD, timeout: 300000 }, // 5 minutes for download
  { stage: StartupStage.EMBEDDER_INIT, timeout: 30000 }, // Can be slow to spawn processes
  { stage: StartupStage.FOLDER_SCAN, timeout: 30000 }, // Can be slow with many folders
  { stage: StartupStage.READY, timeout: 5000 }
];

export function getStageTimeout(stage: StartupStage): number {
  const config = STAGE_TIMEOUTS.find(t => t.stage === stage);
  return config?.timeout || 10000; // Default 10 seconds
}

export function getStageDisplayName(stage: StartupStage): string {
  switch (stage) {
    case StartupStage.WORKER_SPAWN:
      return 'Starting worker process';
    case StartupStage.DB_INIT:
      return 'Initializing database';
    case StartupStage.DB_LOAD:
      return 'Loading indexed files';
    case StartupStage.MODEL_CHECK:
      return 'Checking ML model';
    case StartupStage.MODEL_DOWNLOAD:
      return 'Downloading ML model';
    case StartupStage.EMBEDDER_INIT:
      return 'Initializing embedders';
    case StartupStage.FOLDER_SCAN:
      return 'Scanning folders';
    case StartupStage.READY:
      return 'Ready';
    default:
      return 'Initializing';
  }
}