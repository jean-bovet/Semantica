// Import parser versions from each parser as single source of truth
import { PARSER_VERSION as PDF_VERSION } from '../parsers/pdf';
import { PARSER_VERSION as DOC_VERSION } from '../parsers/doc';
import { PARSER_VERSION as DOCX_VERSION } from '../parsers/docx';
import { PARSER_VERSION as TEXT_VERSION } from '../parsers/text';
import { PARSER_VERSION as RTF_VERSION } from '../parsers/rtf';
import { XLSX_PARSER_VERSION, XLS_PARSER_VERSION } from '../parsers/xlsx';
import { CSV_PARSER_VERSION, TSV_PARSER_VERSION } from '../parsers/csv';

export const PARSER_VERSIONS: Record<string, number> = {
  pdf: PDF_VERSION,
  doc: DOC_VERSION,
  docx: DOCX_VERSION,
  txt: TEXT_VERSION,
  md: TEXT_VERSION,  // Markdown uses the same parser as text
  rtf: RTF_VERSION,
  xlsx: XLSX_PARSER_VERSION,
  xls: XLS_PARSER_VERSION,
  csv: CSV_PARSER_VERSION,
  tsv: TSV_PARSER_VERSION
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
  },
  xlsx: {
    1: "Initial XLSX support with xlsx library"
  },
  xls: {
    1: "Initial XLS support with xlsx library"
  },
  csv: {
    1: "CSV parsing with encoding detection"
  },
  tsv: {
    1: "TSV parsing with encoding detection"
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