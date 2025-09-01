/**
 * Shared parser registry for use in both main and renderer processes
 * This is a simplified version without the actual parser functions
 */

export interface ParserInfo {
  extensions: string[];
  label: string;
  category: 'document' | 'spreadsheet' | 'text' | 'data';
  enabledByDefault: boolean;
}

export const PARSER_INFO: Record<string, ParserInfo> = {
  // Document parsers
  pdf: {
    extensions: ['pdf'],
    label: 'PDF',
    category: 'document',
    enabledByDefault: false
  },
  
  docx: {
    extensions: ['docx'],
    label: 'DOCX',
    category: 'document',
    enabledByDefault: true
  },
  
  doc: {
    extensions: ['doc'],
    label: 'DOC',
    category: 'document',
    enabledByDefault: true
  },
  
  rtf: {
    extensions: ['rtf'],
    label: 'RTF',
    category: 'document',
    enabledByDefault: true
  },
  
  // Spreadsheet parsers
  excel: {
    extensions: ['xlsx', 'xls', 'xlsm'],
    label: 'Excel',
    category: 'spreadsheet',
    enabledByDefault: true
  },
  
  csv: {
    extensions: ['csv'],
    label: 'CSV',
    category: 'spreadsheet',
    enabledByDefault: true
  },
  
  tsv: {
    extensions: ['tsv'],
    label: 'TSV',
    category: 'spreadsheet',
    enabledByDefault: true
  },
  
  // Text parsers
  text: {
    extensions: ['txt'],
    label: 'Text',
    category: 'text',
    enabledByDefault: true
  },
  
  markdown: {
    extensions: ['md'],
    label: 'Markdown',
    category: 'text',
    enabledByDefault: true
  }
};

export type ParserKey = keyof typeof PARSER_INFO;

/**
 * Generate file type options for UI
 */
export function getFileTypeOptions() {
  return Object.entries(PARSER_INFO).map(([key, info]) => ({
    value: key,
    label: info.label,
    category: info.category
  }));
}

/**
 * Generate default file types configuration
 */
export function getDefaultFileTypesUI(): Record<ParserKey, boolean> {
  const result = {} as Record<ParserKey, boolean>;
  
  for (const [key, info] of Object.entries(PARSER_INFO)) {
    result[key as ParserKey] = info.enabledByDefault;
  }
  
  return result;
}