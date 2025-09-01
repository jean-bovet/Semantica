import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ScanOptions {
  excludeBundles: boolean;
  bundlePatterns: string[];
  excludePatterns: string[];
  supportedExtensions: string[];
}

export interface ScanResult {
  files: string[];
  skippedBundles: string[];
}

/**
 * Extracts bundle extensions from glob patterns
 * @param bundlePatterns Array of glob patterns like **\/*.app\/**
 * @returns Array of extensions like .app, .framework
 */
export function extractBundleExtensions(bundlePatterns: string[]): string[] {
  return bundlePatterns
    .map(pattern => {
      const match = pattern.match(/\*\.([^/]+)/);
      return match ? `.${match[1]}` : null;
    })
    .filter(Boolean) as string[];
}

/**
 * Checks if a directory name indicates it's a bundle
 * @param dirName Directory name to check
 * @param bundleExtensions Array of bundle extensions to check against
 * @returns true if the directory is a bundle
 */
export function isBundle(dirName: string, bundleExtensions: string[]): boolean {
  return bundleExtensions.some(ext => dirName.endsWith(ext));
}

/**
 * Checks if a path should be excluded based on patterns
 * @param fullPath Full path to check
 * @param excludePatterns Array of exclude patterns
 * @returns true if the path should be excluded
 */
export function shouldExclude(fullPath: string, excludePatterns: string[]): boolean {
  for (const pattern of excludePatterns) {
    if (typeof pattern === 'string' && fullPath.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a file extension is supported
 * @param fileName File name to check
 * @param supportedExtensions Array of supported extensions (without dots)
 * @returns true if the file type is supported
 */
export function isSupportedFile(fileName: string, supportedExtensions: string[]): boolean {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return supportedExtensions.includes(ext);
}

/**
 * Scans a directory recursively for files, respecting bundle exclusion rules
 * @param rootDir Root directory to scan
 * @param options Scanning options
 * @returns Object containing found files and skipped bundles
 */
export function scanDirectory(rootDir: string, options: ScanOptions): ScanResult {
  const result: ScanResult = {
    files: [],
    skippedBundles: []
  };

  // Extract bundle extensions if bundle exclusion is enabled
  const bundleExtensions = options.excludeBundles 
    ? extractBundleExtensions(options.bundlePatterns)
    : [];

  const scanDir = (dir: string): void => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Check if path matches exclude patterns
        if (shouldExclude(fullPath, options.excludePatterns)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          // Check if this directory is a bundle before recursing
          if (options.excludeBundles && isBundle(entry.name, bundleExtensions)) {
            result.skippedBundles.push(fullPath);
            console.log(`[SCAN] 📦 Skipping bundle directory: ${fullPath}`);
            continue; // Skip this entire directory tree
          }
          
          // Recurse into non-bundle directories
          scanDir(fullPath);
        } else if (entry.isFile()) {
          // Check if this file type is supported
          if (isSupportedFile(entry.name, options.supportedExtensions)) {
            result.files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Ignore permission errors and continue scanning
      if ((error as any).code !== 'EACCES') {
        console.error(`Error scanning directory ${dir}:`, error);
      }
    }
  };

  if (fs.existsSync(rootDir)) {
    scanDir(rootDir);
  }

  return result;
}

/**
 * Scans multiple directories for files
 * @param roots Array of root directories to scan
 * @param options Scanning options
 * @returns Combined scan results from all roots
 */
export function scanDirectories(roots: string[], options: ScanOptions): ScanResult {
  const combinedResult: ScanResult = {
    files: [],
    skippedBundles: []
  };

  for (const root of roots) {
    const result = scanDirectory(root, options);
    combinedResult.files.push(...result.files);
    combinedResult.skippedBundles.push(...result.skippedBundles);
  }

  return combinedResult;
}