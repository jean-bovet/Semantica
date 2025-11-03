import React from 'react';
import { getFileTypeOptions, ParserKey } from '../../../shared/parserRegistry';

interface FileTypesSettingsProps {
  fileTypes: Record<ParserKey, boolean>;
  enableOCR?: boolean;
  onFileTypesChange: (selected: string[]) => void;
  onOCRChange?: (enabled: boolean) => void;
}

function FileTypesSettings({ fileTypes, enableOCR = false, onFileTypesChange, onOCRChange }: FileTypesSettingsProps) {
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

      <div className="settings-subsection" style={{ marginTop: '24px' }}>
        <h3 className="subsection-title">OCR for Scanned PDFs</h3>
        <label className="file-type-item">
          <input
            type="checkbox"
            checked={enableOCR}
            onChange={(e) => onOCRChange?.(e.target.checked)}
            className="file-type-checkbox"
          />
          <span className="file-type-label">Enable OCR for scanned PDFs</span>
        </label>
        <p className="info-note" style={{ marginTop: '8px' }}>
          Extract text from image-based PDFs using macOS Vision framework.
          Enabled by default. May slow down indexing for scanned documents.
        </p>
      </div>
    </div>
  );
}

export default FileTypesSettings;