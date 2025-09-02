import React from 'react';

interface FoldersSettingsProps {
  folders: string[];
  folderStats: Array<{ folder: string; totalFiles: number; indexedFiles: number }>;
  onAddFolders: () => void;
  onRemoveFolder: (folder: string) => void;
}

function FoldersSettings({ folders, folderStats, onAddFolders, onRemoveFolder }: FoldersSettingsProps) {
  return (
    <div className="settings-section">
      <p className="section-description">
        Choose folders to index for semantic search. Files in these folders will be processed and made searchable.
      </p>
      
      <div className="folder-list">
        {folders.map(folder => {
          const folderStat = folderStats?.find(s => s.folder === folder);
          return (
            <div key={folder} className="folder-item">
              <div className="folder-info">
                <span className="folder-path">{folder}</span>
                <span className="folder-stats">
                  {folderStat ? `${folderStat.indexedFiles} / ${folderStat.totalFiles} files` : 'Loading...'}
                </span>
              </div>
              <button 
                onClick={() => onRemoveFolder(folder)}
                className="remove-button"
                title="Remove folder"
              >
                ×
              </button>
            </div>
          );
        })}
        {folders.length === 0 && (
          <div className="empty-state">
            <p>No folders indexed yet</p>
            <p className="empty-state-hint">Add folders to start indexing your documents</p>
          </div>
        )}
      </div>
      
      <button onClick={onAddFolders} className="primary-button">
        + Add Folders
      </button>
    </div>
  );
}

export default FoldersSettings;