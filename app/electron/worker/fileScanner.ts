import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ScanOptions {
  roots: string[];
  excludePatterns: string[];
  supportedExtensions: string[];
}

/**
 * Recursively scan directories for files, applying exclude patterns
 */
export function scanDirectories(options: ScanOptions): string[] {
  const { roots, excludePatterns, supportedExtensions } = options;
  const allFiles: string[] = [];
  
  const scanDir = (dir: string) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Check if path matches exclude patterns
        let excluded = false;
        for (const pattern of excludePatterns) {
          if (typeof pattern === 'string' && fullPath.includes(pattern)) {
            excluded = true;
            break;
          }
        }
        if (excluded) continue;
        
        if (entry.isDirectory()) {
          // Skip .app bundles on macOS
          if (entry.name.endsWith('.app') || entry.name.endsWith('.framework')) {
            continue;
          }
          scanDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).slice(1).toLowerCase();
          if (supportedExtensions.includes(ext)) {
            allFiles.push(fullPath);
          }
        }
      }
    } catch (e) {
      // Ignore permission errors and other scan errors
      // console.debug(`Error scanning directory ${dir}:`, e);
    }
  };
  
  for (const root of roots) {
    if (fs.existsSync(root)) {
      scanDir(root);
    }
  }
  
  return allFiles;
}