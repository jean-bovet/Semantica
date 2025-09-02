import React from 'react';

interface AboutSettingsProps {
  appVersion: string;
}

function AboutSettings({ appVersion }: AboutSettingsProps) {
  return (
    <div className="settings-section">
      <div className="about-header">
        <div className="app-icon">🔍</div>
        <div className="app-info">
          <h2>Semantica</h2>
          <p className="app-tagline">Offline semantic search for macOS</p>
          <p className="app-version">Version {appVersion || 'Loading...'}</p>
        </div>
      </div>
      
      <div className="about-section">
        <h4>Privacy First</h4>
        <p>
          🔒 All processing happens locally on your Mac. Your documents never leave your computer, 
          ensuring complete privacy and security of your data.
        </p>
      </div>
      
      <div className="about-section">
        <h4>Technology</h4>
        <ul className="tech-list">
          <li><strong>Search:</strong> Semantic vector search using multilingual embeddings</li>
          <li><strong>Database:</strong> LanceDB for efficient vector storage</li>
          <li><strong>ML Model:</strong> Xenova/multilingual-e5-small for text understanding</li>
          <li><strong>Platform:</strong> Built with Electron, React, and TypeScript</li>
        </ul>
      </div>
      
      <div className="about-section">
        <h4>Resources</h4>
        <div className="link-list">
          <a href="#" onClick={(e) => {
            e.preventDefault();
            window.api.system.openExternal('https://github.com/jean-bovet/Semantica');
          }}>
            GitHub Repository
          </a>
          <a href="#" onClick={(e) => {
            e.preventDefault();
            window.api.system.openExternal('https://github.com/jean-bovet/Semantica/issues');
          }}>
            Report an Issue
          </a>
          <a href="#" onClick={(e) => {
            e.preventDefault();
            window.api.system.openExternal('https://github.com/jean-bovet/Semantica/releases');
          }}>
            Release Notes
          </a>
        </div>
      </div>
      
      <div className="about-footer">
        <p>© 2025 Jean Bovet. All rights reserved.</p>
      </div>
    </div>
  );
}

export default AboutSettings;