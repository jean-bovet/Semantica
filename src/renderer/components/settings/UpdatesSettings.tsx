import React from 'react';

interface UpdatesSettingsProps {
  appVersion: string;
  checkingUpdate: boolean;
  onCheckForUpdates: () => void;
}

function UpdatesSettings({ appVersion, checkingUpdate, onCheckForUpdates }: UpdatesSettingsProps) {
  const handleOpenReleaseNotes = (e: React.MouseEvent) => {
    e.preventDefault();
    window.api.system.openExternal('https://github.com/jean-bovet/Semantica/releases');
  };

  return (
    <div className="settings-section updates-section">
      <p className="section-description">
        Keep Semantica up to date with the latest features and improvements.
      </p>
      
      <div className="version-info">
        <div className="version-card">
          <h4>Current Version</h4>
          <div className="version-number">{appVersion || 'Loading...'}</div>
        </div>
      </div>
      
      <div className="update-actions">
        <button 
          onClick={onCheckForUpdates} 
          className="primary-button" 
          disabled={checkingUpdate}
        >
          {checkingUpdate ? 'Checking...' : '🔄 Check for Updates'}
        </button>
      </div>
      
      <div className="update-info">
        <h4>Update Information</h4>
        <ul className="info-list">
          <li>Updates are downloaded automatically in the background</li>
          <li>You'll be prompted to restart when an update is ready</li>
          <li>Your indexed data and settings are preserved during updates</li>
        </ul>
      </div>
      
      <div className="release-notes">
        <h4>What's New</h4>
        <p className="info-note">
          Check out the <a href="#" onClick={handleOpenReleaseNotes}>release notes</a> for information about recent updates.
        </p>
      </div>
    </div>
  );
}

export default UpdatesSettings;