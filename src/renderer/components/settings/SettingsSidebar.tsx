import React from 'react';
import './SettingsSidebar.css';
import { FolderOpen, FileText, Search, RefreshCw, Info } from 'lucide-react';
import Icon from '../Icon';

export type SettingsSection = 'folders' | 'filetypes' | 'indexing' | 'updates' | 'about';

interface SettingsSidebarProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

interface SidebarItem {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<any>;
}

const sidebarItems: SidebarItem[] = [
  { id: 'folders', label: 'Folders', icon: FolderOpen },
  { id: 'filetypes', label: 'File Types', icon: FileText },
  { id: 'indexing', label: 'Indexing', icon: Search },
  { id: 'updates', label: 'Updates', icon: RefreshCw },
  { id: 'about', label: 'About', icon: Info }
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
            <span className="sidebar-icon"><Icon icon={item.icon} size={18} /></span>
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default SettingsSidebar;