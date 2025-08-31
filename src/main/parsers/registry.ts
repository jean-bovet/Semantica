/**
 * Central Parser Registry
 * This is the SINGLE source of truth for all file parsers in the application.
 * To add a new parser, simply add an entry to PARSER_REGISTRY below.
 */

export interface ParserDefinition {
  // File type identification
  extensions: string[];           // File extensions this parser handles
  label: string;                  // Display name in UI
  category: 'document' | 'spreadsheet' | 'text' | 'data';
  
  // Parser function (lazy loaded for efficiency)
  // Note: PDF parser returns different type, but we handle it specially
  parser: () => Promise<(filePath: string) => Promise<any>>;
  
  // Version tracking
  version: number;
  versionHistory: Record<number, string>;
  
  // Configuration
  enabledByDefault: boolean;
  
  // Optional processing settings
  chunkSize?: number;             // Custom chunk size (default: 500)
  chunkOverlap?: number;          // Custom overlap (default: 60)
}

/**
 * THE PARSER REGISTRY
 * Add new parsers here - everything else auto-updates!
 */
export const PARSER_REGISTRY: Record<string, ParserDefinition> = {
  // Document parsers
  pdf: {
    extensions: ['pdf'],
    label: 'PDF',
    category: 'document' as const,
    parser: () => import('./pdf').then(m => m.parsePdf),
    version: 1,
    versionHistory: {
      1: "Initial pdf-parse implementation"
    },
    enabledByDefault: false  // Can cause memory issues, disabled by default
  },
  
  docx: {
    extensions: ['docx'],
    label: 'DOCX',
    category: 'document' as const,
    parser: () => import('./docx').then(m => m.parseDocx),
    version: 1,
    versionHistory: {
      1: "Initial mammoth implementation"
    },
    enabledByDefault: true
  },
  
  doc: {
    extensions: ['doc'],
    label: 'DOC',
    category: 'document' as const,
    parser: () => import('./doc').then(m => m.parseDoc),
    version: 2,
    versionHistory: {
      1: "Attempted to parse as RTF (failed for most files)",
      2: "Proper binary .doc support with word-extractor"
    },
    enabledByDefault: true
  },
  
  rtf: {
    extensions: ['rtf'],
    label: 'RTF',
    category: 'document' as const,
    parser: () => import('./rtf').then(m => m.parseRtf),
    version: 1,
    versionHistory: {
      1: "Basic RTF stripping"
    },
    enabledByDefault: true
  },
  
  // Spreadsheet parsers
  excel: {
    extensions: ['xlsx', 'xls', 'xlsm'],
    label: 'Excel',
    category: 'spreadsheet' as const,
    parser: () => import('./xlsx').then(m => m.parseXLSX),
    version: 1,
    versionHistory: {
      1: "Initial XLSX/XLS support with xlsx library"
    },
    enabledByDefault: true
  },
  
  csv: {
    extensions: ['csv'],
    label: 'CSV',
    category: 'spreadsheet' as const,
    parser: () => import('./csv').then(m => m.parseCSV),
    version: 1,
    versionHistory: {
      1: "CSV parsing with encoding detection"
    },
    enabledByDefault: true
  },
  
  tsv: {
    extensions: ['tsv'],
    label: 'TSV',
    category: 'spreadsheet' as const,
    parser: () => import('./csv').then(m => m.parseTSV),
    version: 1,
    versionHistory: {
      1: "TSV parsing with encoding detection"
    },
    enabledByDefault: true
  },
  
  // Text parsers
  text: {
    extensions: ['txt'],
    label: 'Text',
    category: 'text' as const,
    parser: () => import('./text').then(m => m.parseText),
    version: 3,
    versionHistory: {
      1: "Basic text parsing (UTF-8 only)",
      2: "Initial multi-encoding attempt",
      3: "Multi-encoding support with chardet and iconv-lite"
    },
    enabledByDefault: true
  },
  
  markdown: {
    extensions: ['md'],
    label: 'Markdown',
    category: 'text' as const,
    parser: () => import('./text').then(m => m.parseText),  // Uses same parser as text
    version: 3,
    versionHistory: {
      1: "Markdown as text (UTF-8 only)",
      2: "Initial multi-encoding attempt",
      3: "Multi-encoding support with chardet and iconv-lite"
    },
    enabledByDefault: true
  }
};

// Type exports for TypeScript
export type ParserKey = keyof typeof PARSER_REGISTRY;
export type FileExtension = typeof PARSER_REGISTRY[ParserKey]['extensions'][number];

/**
 * Helper function to get parser by file extension
 */
export function getParserForExtension(extension: string): [ParserKey, ParserDefinition] | null {
  const ext = extension.toLowerCase().replace('.', '');
  
  for (const [key, definition] of Object.entries(PARSER_REGISTRY)) {
    if (definition.extensions.includes(ext)) {
      return [key as ParserKey, definition];
    }
  }
  
  return null;
}

/**
 * Helper function to get all supported extensions
 */
export function getAllSupportedExtensions(): string[] {
  const extensions = new Set<string>();
  
  for (const definition of Object.values(PARSER_REGISTRY)) {
    definition.extensions.forEach(ext => extensions.add(ext));
  }
  
  return Array.from(extensions);
}

/**
 * Helper function to get enabled extensions based on config
 */
export function getEnabledExtensions(fileTypes: Partial<Record<ParserKey, boolean>>): string[] {
  const extensions = new Set<string>();
  
  for (const [key, definition] of Object.entries(PARSER_REGISTRY)) {
    if (fileTypes[key as ParserKey]) {
      definition.extensions.forEach(ext => extensions.add(ext));
    }
  }
  
  return Array.from(extensions);
}

/**
 * Generate default file types configuration
 */
export function getDefaultFileTypes(): Record<ParserKey, boolean> {
  const result = {} as Record<ParserKey, boolean>;
  
  for (const [key, definition] of Object.entries(PARSER_REGISTRY)) {
    result[key as ParserKey] = definition.enabledByDefault;
  }
  
  return result;
}