import { contextBridge, ipcRenderer } from 'electron';

export interface SearchHit {
  id: string;
  path: string;
  page: number;
  offset: number;
  text: string;
  score: number;
  title?: string;
}

export interface IndexProgress {
  queued: number;
  processing: number;
  done: number;
  errors: number;
  paused: boolean;
}

const api = {
  dialog: {
    selectFolders: () => ipcRenderer.invoke('dialog:selectFolders'),
    confirm: (title: string, message: string) => ipcRenderer.invoke('dialog:confirm', title, message),
    error: (title: string, message: string) => ipcRenderer.invoke('dialog:error', title, message)
  },
  
  indexer: {
    watchStart: (roots: string[], options?: { include?: string[]; exclude?: string[] }) =>
      ipcRenderer.invoke('indexer:watchStart', { roots, options }),
    
    enqueue: (paths: string[]) =>
      ipcRenderer.invoke('indexer:enqueue', { paths }),
    
    pause: () => ipcRenderer.invoke('indexer:pause'),
    
    resume: () => ipcRenderer.invoke('indexer:resume'),
    
    progress: (): Promise<IndexProgress> =>
      ipcRenderer.invoke('indexer:progress'),
    
    onProgress: (callback: (progress: IndexProgress) => void) => {
      ipcRenderer.on('indexer:progress', (_, progress) => callback(progress));
      return () => ipcRenderer.removeAllListeners('indexer:progress');
    },
    
    getWatchedFolders: (): Promise<string[]> =>
      ipcRenderer.invoke('indexer:getWatchedFolders'),
    
    reindexAll: () => ipcRenderer.invoke('indexer:reindexAll'),
    
    searchFiles: (query: string) => ipcRenderer.invoke('indexer:searchFiles', query)
  },
  
  search: {
    query: (q: string, k: number = 10): Promise<SearchHit[]> =>
      ipcRenderer.invoke('search:query', { q, k })
  },
  
  system: {
    openPath: (path: string) =>
      ipcRenderer.invoke('system:openPath', path),
    
    openPreview: (path: string, page?: number) =>
      ipcRenderer.invoke('system:openPreview', path, page),
    
    getDataPath: (): Promise<string> =>
      ipcRenderer.invoke('system:getDataPath')
  },
  
  db: {
    stats: () => ipcRenderer.invoke('db:stats')
  },
  
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (settings: any) => ipcRenderer.invoke('settings:update', settings)
  }
};

contextBridge.exposeInMainWorld('api', api);

export type API = typeof api;