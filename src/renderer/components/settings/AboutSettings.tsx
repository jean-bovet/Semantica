import React from 'react';
import { Lock } from 'lucide-react';
import Icon from '../Icon';

interface AboutSettingsProps {
  appVersion: string;
}

function AboutSettings({ appVersion }: AboutSettingsProps) {
  return (
    <div className="settings-section">
      <p className="app-version" style={{ 
        margin: '0 0 32px 0',
        padding: 0,
        background: 'none',
        border: 'none'
      }}>Version {appVersion || 'Loading...'}</p>
      
      <div className="about-section">
        <h4>Privacy First</h4>
        <p>
          <><Icon icon={Lock} size={16} /> All processing happens locally on your Mac. Your documents never leave your computer,</> 
          ensuring complete privacy and security of your data.
        </p>
      </div>
      
      <div className="about-section">
        <h4>Technology</h4>
        <ul className="tech-list">
          <li><strong>Search:</strong> Semantic vector search using multilingual embeddings</li>
          <li><strong>Database:</strong> LanceDB for efficient vector storage</li>
          <li><strong>ML Model:</strong> paraphrase-multilingual-mpnet-base-v2 for text understanding</li>
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