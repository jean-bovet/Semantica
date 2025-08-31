/**
 * Parser Versions - Auto-generated from Parser Registry
 * This file is now completely derived from the central registry
 */

import { PARSER_REGISTRY } from '../parsers/registry';

// Auto-generate parser versions from registry
export const PARSER_VERSIONS: Record<string, number> = (() => {
  const versions: Record<string, number> = {};
  
  for (const [key, definition] of Object.entries(PARSER_REGISTRY)) {
    // Map each extension to its parser version
    for (const ext of definition.extensions) {
      versions[ext] = definition.version;
    }
  }
  
  return versions;
})();

// Auto-generate version history from registry
export const VERSION_HISTORY: Record<string, Record<number, string>> = (() => {
  const history: Record<string, Record<number, string>> = {};
  
  for (const [key, definition] of Object.entries(PARSER_REGISTRY)) {
    // Map each extension to its version history
    for (const ext of definition.extensions) {
      history[ext] = definition.versionHistory;
    }
  }
  
  return history;
})();

export interface ParserVersion {
  ext: string;
  version: number;
  description: string;
}

export function getParserVersion(ext: string): number {
  return PARSER_VERSIONS[ext.toLowerCase()] || 0;
}

export function getVersionHistory(ext: string): Record<number, string> | undefined {
  return VERSION_HISTORY[ext.toLowerCase()];
}

// Re-export parser versions for backward compatibility
// These are no longer needed but kept to avoid breaking changes
export const PARSER_VERSION = 1;  // Generic fallback
export const PDF_VERSION = PARSER_REGISTRY.pdf.version;
export const DOC_VERSION = PARSER_REGISTRY.doc.version;
export const DOCX_VERSION = PARSER_REGISTRY.docx.version;
export const TEXT_VERSION = PARSER_REGISTRY.text.version;
export const RTF_VERSION = PARSER_REGISTRY.rtf.version;
export const XLSX_PARSER_VERSION = PARSER_REGISTRY.excel.version;
export const XLS_PARSER_VERSION = PARSER_REGISTRY.excel.version;
export const CSV_PARSER_VERSION = PARSER_REGISTRY.csv.version;
export const TSV_PARSER_VERSION = PARSER_REGISTRY.tsv.version;