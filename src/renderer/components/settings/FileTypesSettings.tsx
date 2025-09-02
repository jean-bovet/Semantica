import React from 'react';
import { getFileTypeOptions, ParserKey } from '../../../shared/parserRegistry';

interface FileTypesSettingsProps {
  fileTypes: Record<ParserKey, boolean>;
  onFileTypesChange: (selected: string[]) => void;
}

function FileTypesSettings({ fileTypes, onFileTypesChange }: FileTypesSettingsProps) {
  const fileTypeOptions = getFileTypeOptions();

  const handleToggle = (key: string, checked: boolean) => {
    const newSelected = Object.entries(fileTypes)
      .filter(([k, v]) => k === key ? checked : v)
      .map(([k]) => k);
    onFileTypesChange(newSelected);
  };

  return (
    <div className="settings-section">
      <p className="section-description">
        Select which file types should be indexed. Only files with these extensions will be processed.
      </p>
      
      <div className="file-types-list">
        {fileTypeOptions.map(option => (
          <label key={option.value} className="file-type-item">
            <input
              type="checkbox"
              checked={fileTypes[option.value as ParserKey] || false}
              onChange={(e) => handleToggle(option.value, e.target.checked)}
              className="file-type-checkbox"
            />
            <span className="file-type-label">{option.label}</span>
          </label>
        ))}
      </div>
      
      <p className="info-note">
        Note: Scanned PDFs without text layers cannot be indexed. OCR is required for such files.
      </p>
    </div>
  );
}

export default FileTypesSettings;