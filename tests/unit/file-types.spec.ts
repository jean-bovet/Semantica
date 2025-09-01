import { describe, it, expect } from 'vitest';
import path from 'node:path';

describe('File Type Detection and Support', () => {
  
  describe('Supported File Extensions', () => {
    const supportedExtensions = ['pdf', 'txt', 'md', 'docx', 'rtf', 'doc'];
    const unsupportedExtensions = ['jpg', 'png', 'mp4', 'zip', 'exe', 'dmg'];

    const isFileTypeSupported = (filePath: string): boolean => {
      const ext = path.extname(filePath).slice(1).toLowerCase();
      return supportedExtensions.includes(ext);
    };

    it('should identify supported text file types', () => {
      expect(isFileTypeSupported('document.txt')).toBe(true);
      expect(isFileTypeSupported('README.md')).toBe(true);
      expect(isFileTypeSupported('notes.MD')).toBe(true); // Case insensitive
    });

    it('should identify supported document file types', () => {
      expect(isFileTypeSupported('report.pdf')).toBe(true);
      expect(isFileTypeSupported('essay.docx')).toBe(true);
      expect(isFileTypeSupported('letter.rtf')).toBe(true);
      expect(isFileTypeSupported('old-document.doc')).toBe(true);
    });

    it('should reject unsupported file types', () => {
      expect(isFileTypeSupported('image.jpg')).toBe(false);
      expect(isFileTypeSupported('photo.png')).toBe(false);
      expect(isFileTypeSupported('video.mp4')).toBe(false);
      expect(isFileTypeSupported('archive.zip')).toBe(false);
    });

    it('should handle files without extensions', () => {
      expect(isFileTypeSupported('README')).toBe(false);
      expect(isFileTypeSupported('Makefile')).toBe(false);
    });

    it('should handle files with multiple dots', () => {
      expect(isFileTypeSupported('my.document.pdf')).toBe(true);
      expect(isFileTypeSupported('archive.tar.gz')).toBe(false);
      expect(isFileTypeSupported('report.v2.docx')).toBe(true);
    });

    it('should handle edge cases', () => {
      expect(isFileTypeSupported('')).toBe(false);
      expect(isFileTypeSupported('.')).toBe(false);
      expect(isFileTypeSupported('.pdf')).toBe(false); // Hidden file without proper extension
      expect(isFileTypeSupported('.gitignore')).toBe(false);
    });
  });

  describe('File Type Configuration', () => {
    interface FileTypeConfig {
      pdf: boolean;
      txt: boolean;
      md: boolean;
      docx: boolean;
      rtf: boolean;
      doc: boolean;
    }

    const defaultConfig: FileTypeConfig = {
      pdf: true,   // Now enabled by default with isolated embedder
      txt: true,
      md: true,
      docx: true,
      rtf: true,
      doc: true
    };

    it('should have all file types enabled by default', () => {
      expect(defaultConfig.pdf).toBe(true);
      expect(defaultConfig.txt).toBe(true);
      expect(defaultConfig.md).toBe(true);
      expect(defaultConfig.docx).toBe(true);
      expect(defaultConfig.rtf).toBe(true);
      expect(defaultConfig.doc).toBe(true);
    });

    it('should filter files based on configuration', () => {
      const config: FileTypeConfig = {
        ...defaultConfig,
        pdf: false, // Disable PDF
        docx: false // Disable DOCX
      };

      const shouldIndex = (filePath: string, config: FileTypeConfig): boolean => {
        const ext = path.extname(filePath).slice(1).toLowerCase();
        return config[ext as keyof FileTypeConfig] ?? false;
      };

      expect(shouldIndex('document.pdf', config)).toBe(false);
      expect(shouldIndex('report.docx', config)).toBe(false);
      expect(shouldIndex('notes.txt', config)).toBe(true);
      expect(shouldIndex('README.md', config)).toBe(true);
    });
  });

  describe('File Exclusion Patterns', () => {
    const defaultExcludePatterns = ['node_modules', '.git', '*.tmp', '.DS_Store'];

    const shouldExclude = (filePath: string, patterns: string[]): boolean => {
      const fileName = path.basename(filePath);
      const dirPath = path.dirname(filePath);
      
      return patterns.some(pattern => {
        // Handle glob patterns
        if (pattern.startsWith('*')) {
          const ext = pattern.slice(1);
          return fileName.endsWith(ext);
        }
        // Handle patterns starting with special chars (like ~)
        if (pattern.endsWith('*')) {
          const prefix = pattern.slice(0, -1);
          return fileName.startsWith(prefix);
        }
        // Handle exact matches
        if (fileName === pattern) {
          return true;
        }
        // Handle directory patterns
        if (dirPath.includes(pattern)) {
          return true;
        }
        return false;
      });
    };

    it('should exclude system files', () => {
      expect(shouldExclude('/Users/test/.DS_Store', defaultExcludePatterns)).toBe(true);
      expect(shouldExclude('/project/.DS_Store', defaultExcludePatterns)).toBe(true);
    });

    it('should exclude temporary files', () => {
      expect(shouldExclude('/tmp/file.tmp', defaultExcludePatterns)).toBe(true);
      expect(shouldExclude('/Users/test/document.tmp', defaultExcludePatterns)).toBe(true);
      expect(shouldExclude('/Users/test/~document.docx', ['~*'])).toBe(true); // Now handles prefix patterns
    });

    it('should exclude version control directories', () => {
      expect(shouldExclude('/project/.git/config', defaultExcludePatterns)).toBe(true);
      expect(shouldExclude('/project/.svn/entries', ['.svn'])).toBe(true);
    });

    it('should exclude node_modules', () => {
      expect(shouldExclude('/project/node_modules/package/index.js', defaultExcludePatterns)).toBe(true);
      expect(shouldExclude('/node_modules/test.txt', defaultExcludePatterns)).toBe(true);
    });

    it('should not exclude valid files', () => {
      expect(shouldExclude('/Users/test/document.pdf', defaultExcludePatterns)).toBe(false);
      expect(shouldExclude('/project/README.md', defaultExcludePatterns)).toBe(false);
      expect(shouldExclude('/Users/test/notes.txt', defaultExcludePatterns)).toBe(false);
    });
  });

  describe('File Size Limits', () => {
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

    const isFileSizeValid = (sizeInBytes: number): boolean => {
      return sizeInBytes > 0 && sizeInBytes <= MAX_FILE_SIZE;
    };

    it('should accept files within size limit', () => {
      expect(isFileSizeValid(1024)).toBe(true); // 1KB
      expect(isFileSizeValid(1024 * 1024)).toBe(true); // 1MB
      expect(isFileSizeValid(10 * 1024 * 1024)).toBe(true); // 10MB
      expect(isFileSizeValid(49 * 1024 * 1024)).toBe(true); // 49MB
    });

    it('should reject files exceeding size limit', () => {
      expect(isFileSizeValid(51 * 1024 * 1024)).toBe(false); // 51MB
      expect(isFileSizeValid(100 * 1024 * 1024)).toBe(false); // 100MB
      expect(isFileSizeValid(1024 * 1024 * 1024)).toBe(false); // 1GB
    });

    it('should reject empty or invalid files', () => {
      expect(isFileSizeValid(0)).toBe(false);
      expect(isFileSizeValid(-1)).toBe(false);
      expect(isFileSizeValid(NaN)).toBe(false);
    });
  });

  describe('MIME Type Detection', () => {
    const getMimeType = (filePath: string): string => {
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mimeTypes: Record<string, string> = {
        'pdf': 'application/pdf',
        'txt': 'text/plain',
        'md': 'text/markdown',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'rtf': 'application/rtf',
        'doc': 'application/msword'
      };
      return mimeTypes[ext] || 'application/octet-stream';
    };

    it('should return correct MIME types for supported files', () => {
      expect(getMimeType('document.pdf')).toBe('application/pdf');
      expect(getMimeType('notes.txt')).toBe('text/plain');
      expect(getMimeType('README.md')).toBe('text/markdown');
      expect(getMimeType('report.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(getMimeType('letter.rtf')).toBe('application/rtf');
      expect(getMimeType('old.doc')).toBe('application/msword');
    });

    it('should return default MIME type for unknown files', () => {
      expect(getMimeType('image.jpg')).toBe('application/octet-stream');
      expect(getMimeType('data.json')).toBe('application/octet-stream');
      expect(getMimeType('unknown')).toBe('application/octet-stream');
    });
  });
});