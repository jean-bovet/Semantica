export const PARSER_VERSIONS: Record<string, number> = {
  pdf: 1,    // Version 1: Initial pdf-parse implementation
  doc: 2,    // Version 2: Proper binary .doc support with word-extractor
  docx: 1,   // Version 1: Initial mammoth implementation
  txt: 3,    // Version 3: Multi-encoding support with chardet and iconv-lite
  md: 3,     // Version 3: Multi-encoding support with chardet and iconv-lite
  rtf: 1     // Version 1: Basic RTF stripping
};

export const VERSION_HISTORY: Record<string, Record<number, string>> = {
  pdf: {
    1: "Initial pdf-parse implementation",
    // Future: 2: "Added OCR support for scanned PDFs"
  },
  doc: {
    1: "Attempted to parse as RTF (failed for most files)",
    2: "Proper binary .doc support with word-extractor"
  },
  docx: {
    1: "Initial mammoth implementation"
  },
  txt: {
    1: "Basic text parsing (UTF-8 only)",
    2: "Initial multi-encoding attempt",
    3: "Multi-encoding support with chardet and iconv-lite"
  },
  md: {
    1: "Markdown as text (UTF-8 only)",
    2: "Initial multi-encoding attempt",
    3: "Multi-encoding support with chardet and iconv-lite"
  },
  rtf: {
    1: "Basic RTF stripping"
  }
};

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