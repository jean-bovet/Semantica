import fs from 'node:fs';
import path from 'node:path';
import type { ConfigManager } from '../config';

/**
 * Calculate a hash for a file based on its size and modification time.
 * This provides a quick way to detect if a file has changed without reading its contents.
 *
 * @param filePath - Path to the file
 * @returns Hash string in format "size-mtime"
 */
export async function getFileHash(filePath: string): Promise<string> {
  const stat = await fs.promises.stat(filePath);
  return `${stat.size}-${stat.mtimeMs}`;
}

/**
 * Check if a file is inside a macOS bundle (like .app, .framework, etc.)
 * based on the configured bundle patterns.
 *
 * @param filePath - Path to check
 * @param configManager - Config manager instance to get bundle settings
 * @returns true if file is inside a bundle and bundle exclusion is enabled
 */
export function isInsideBundle(filePath: string, configManager: ConfigManager | null): boolean {
  // Check if file is inside a macOS bundle based on config patterns
  if (!configManager?.getSettings().excludeBundles) {
    return false;
  }

  const bundlePatterns = configManager.getSettings().bundlePatterns || [];

  // Extract bundle extensions from patterns (e.g., "**/*.app/**" -> ".app")
  const bundleExtensions = bundlePatterns
    .map(pattern => {
      const match = pattern.match(/\*\.([^/]+)/);
      return match ? `.${match[1]}` : null;
    })
    .filter(Boolean) as string[];

  const pathComponents = filePath.split(path.sep);
  for (const component of pathComponents) {
    for (const ext of bundleExtensions) {
      if (component.endsWith(ext)) {
        return true;
      }
    }
  }
  return false;
}
