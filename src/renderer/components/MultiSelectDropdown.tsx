import React, { useState, useRef, useEffect } from 'react';
import './MultiSelectDropdown.css';

interface MultiSelectDropdownProps {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

function MultiSelectDropdown({ options, selected, onChange, placeholder = 'Select...' }: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (value: string) => {
    const newSelected = selected.includes(value)
      ? selected.filter(v => v !== value)
      : [...selected, value];
    onChange(newSelected);
  };

  const getDisplayText = () => {
    if (selected.length === 0) return placeholder;
    if (selected.length === options.length) return 'All file types';
    const labels = selected
      .map(val => options.find(opt => opt.value === val)?.label)
      .filter(Boolean)
      .slice(0, 3)
      .join(', ');
    return selected.length > 3 ? `${labels}... (${selected.length} selected)` : `${labels} (${selected.length} selected)`;
  };

  return (
    <div className="multi-select-dropdown" ref={dropdownRef}>
      <div 
        className="multi-select-trigger" 
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="multi-select-text">{getDisplayText()}</span>
        <span className="multi-select-arrow">▼</span>
      </div>
      {isOpen && (
        <div className="multi-select-options">
          {options.map(option => (
            <label key={option.value} className="multi-select-option">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggleOption(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default MultiSelectDropdown;