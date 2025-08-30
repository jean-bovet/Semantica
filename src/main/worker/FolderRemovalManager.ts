/**
 * FolderRemovalManager - Handles cleanup when folders are removed from indexing
 */

export interface FolderStats {
  total: number;
  indexed: number;
}

export class FolderRemovalManager {
  /**
   * Identifies folders that have been removed and need cleanup
   */
  identifyRemovedFolders(
    currentFolders: Map<string, FolderStats>,
    newFolders: string[]
  ): string[] {
    const removedFolders: string[] = [];
    
    for (const [folder] of currentFolders) {
      if (!newFolders.includes(folder)) {
        removedFolders.push(folder);
      }
    }
    
    return removedFolders;
  }

  /**
   * Removes folders from the stats map that are no longer being watched
   */
  updateFolderStats(
    folderStats: Map<string, FolderStats>,
    newFolders: string[]
  ): string[] {
    const removedFolders: string[] = [];
    
    // Remove folders that are no longer in the list
    for (const [folder] of folderStats) {
      if (!newFolders.includes(folder)) {
        removedFolders.push(folder);
        folderStats.delete(folder);
      }
    }
    
    // Add new folders if they don't exist
    for (const folder of newFolders) {
      if (!folderStats.has(folder)) {
        folderStats.set(folder, { total: 0, indexed: 0 });
      }
    }
    
    return removedFolders;
  }

  /**
   * Identifies files that need to be removed when folders are removed
   */
  identifyFilesToRemove(
    fileHashes: Map<string, string>,
    removedFolders: string[]
  ): string[] {
    const filesToRemove: string[] = [];
    
    for (const [filePath] of fileHashes) {
      for (const folder of removedFolders) {
        // Ensure we're matching folder boundaries correctly
        if (filePath.startsWith(folder + '/')) {
          filesToRemove.push(filePath);
          break;
        }
      }
    }
    
    return filesToRemove;
  }

  /**
   * Removes files from the fileHashes map for removed folders
   */
  removeFilesFromCache(
    fileHashes: Map<string, string>,
    removedFolders: string[]
  ): number {
    let removedCount = 0;
    
    const filesToRemove = this.identifyFilesToRemove(fileHashes, removedFolders);
    
    for (const filePath of filesToRemove) {
      if (fileHashes.delete(filePath)) {
        removedCount++;
      }
    }
    
    return removedCount;
  }

  /**
   * Filters a list of file paths to only include those in removed folders
   */
  filterPathsInFolders(
    allPaths: string[],
    removedFolders: string[]
  ): string[] {
    return allPaths.filter(path => {
      return removedFolders.some(folder => path.startsWith(folder + '/'));
    });
  }
}