import React from 'react';
import './SettingsSidebar.css';

export type SettingsSection = 'folders' | 'filetypes' | 'indexing' | 'updates' | 'about';

interface SettingsSidebarProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

interface SidebarItem {
  id: SettingsSection;
  label: string;
  icon: string;
}

const sidebarItems: SidebarItem[] = [
  { id: 'folders', label: 'Folders', icon: '📁' },
  { id: 'filetypes', label: 'File Types', icon: '📄' },
  { id: 'indexing', label: 'Indexing', icon: '🔍' },
  { id: 'updates', label: 'Updates', icon: '🔄' },
  { id: 'about', label: 'About', icon: 'ℹ️' }
];

function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  return (
    <div className="settings-sidebar">
      <nav className="sidebar-nav">
        {sidebarItems.map(item => (
          <button
            key={item.id}
            className={`sidebar-item ${activeSection === item.id ? 'active' : ''}`}
            onClick={() => onSectionChange(item.id)}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default SettingsSidebar;