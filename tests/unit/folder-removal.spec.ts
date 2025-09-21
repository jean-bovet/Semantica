import { describe, it, expect, beforeEach } from 'vitest';
import { FolderRemovalManager } from '../../src/main/core/reindex/FolderRemovalManager';
import type { FolderStats } from '../../src/main/core/reindex/FolderRemovalManager';

describe('FolderRemovalManager', () => {
  let manager: FolderRemovalManager;
  let folderStats: Map<string, FolderStats>;
  let fileHashes: Map<string, string>;

  beforeEach(() => {
    manager = new FolderRemovalManager();
    folderStats = new Map();
    fileHashes = new Map();
  });

  describe('identifyRemovedFolders', () => {
    it('should identify folders that are no longer in the new list', () => {
      // Setup
      folderStats.set('/folder1', { total: 10, indexed: 8 });
      folderStats.set('/folder2', { total: 5, indexed: 5 });
      folderStats.set('/folder3', { total: 3, indexed: 2 });
      
      const newFolders = ['/folder1', '/folder3'];
      
      // Act
      const removed = manager.identifyRemovedFolders(folderStats, newFolders);
      
      // Assert
      expect(removed).toEqual(['/folder2']);
    });

    it('should return empty array when no folders are removed', () => {
      folderStats.set('/folder1', { total: 10, indexed: 8 });
      folderStats.set('/folder2', { total: 5, indexed: 5 });
      
      const newFolders = ['/folder1', '/folder2'];
      
      const removed = manager.identifyRemovedFolders(folderStats, newFolders);
      
      expect(removed).toEqual([]);
    });

    it('should identify all folders when empty array is passed', () => {
      folderStats.set('/folder1', { total: 10, indexed: 8 });
      folderStats.set('/folder2', { total: 5, indexed: 5 });
      
      const newFolders: string[] = [];
      
      const removed = manager.identifyRemovedFolders(folderStats, newFolders);
      
      expect(removed).toHaveLength(2);
      expect(removed).toContain('/folder1');
      expect(removed).toContain('/folder2');
    });
  });

  describe('updateFolderStats', () => {
    it('should remove folders and add new ones', () => {
      // Setup: Start with folders 1 and 2
      folderStats.set('/folder1', { total: 10, indexed: 8 });
      folderStats.set('/folder2', { total: 5, indexed: 5 });
      
      // Act: Keep folder1, remove folder2, add folder3
      const newFolders = ['/folder1', '/folder3'];
      const removed = manager.updateFolderStats(folderStats, newFolders);
      
      // Assert
      expect(removed).toEqual(['/folder2']);
      expect(folderStats.size).toBe(2);
      expect(folderStats.has('/folder1')).toBe(true);
      expect(folderStats.has('/folder2')).toBe(false);
      expect(folderStats.has('/folder3')).toBe(true);
      expect(folderStats.get('/folder1')).toEqual({ total: 10, indexed: 8 }); // Preserved
      expect(folderStats.get('/folder3')).toEqual({ total: 0, indexed: 0 }); // New
    });

    it('should handle removing all folders', () => {
      folderStats.set('/folder1', { total: 10, indexed: 8 });
      folderStats.set('/folder2', { total: 5, indexed: 5 });
      
      const removed = manager.updateFolderStats(folderStats, []);
      
      expect(removed).toHaveLength(2);
      expect(folderStats.size).toBe(0);
    });

    it('should handle adding folders to empty map', () => {
      const removed = manager.updateFolderStats(folderStats, ['/folder1', '/folder2']);
      
      expect(removed).toEqual([]);
      expect(folderStats.size).toBe(2);
      expect(folderStats.has('/folder1')).toBe(true);
      expect(folderStats.has('/folder2')).toBe(true);
    });
  });

  describe('identifyFilesToRemove', () => {
    it('should identify files in removed folders', () => {
      fileHashes.set('/folder1/file1.txt', 'hash1');
      fileHashes.set('/folder2/file1.txt', 'hash2');
      fileHashes.set('/folder2/subfolder/file2.txt', 'hash3');
      fileHashes.set('/folder3/file1.txt', 'hash4');
      
      const removedFolders = ['/folder2'];
      const filesToRemove = manager.identifyFilesToRemove(fileHashes, removedFolders);
      
      expect(filesToRemove).toHaveLength(2);
      expect(filesToRemove).toContain('/folder2/file1.txt');
      expect(filesToRemove).toContain('/folder2/subfolder/file2.txt');
      expect(filesToRemove).not.toContain('/folder1/file1.txt');
      expect(filesToRemove).not.toContain('/folder3/file1.txt');
    });

    it('should handle multiple removed folders', () => {
      fileHashes.set('/folder1/file1.txt', 'hash1');
      fileHashes.set('/folder2/file1.txt', 'hash2');
      fileHashes.set('/folder3/file1.txt', 'hash3');
      
      const removedFolders = ['/folder1', '/folder3'];
      const filesToRemove = manager.identifyFilesToRemove(fileHashes, removedFolders);
      
      expect(filesToRemove).toHaveLength(2);
      expect(filesToRemove).toContain('/folder1/file1.txt');
      expect(filesToRemove).toContain('/folder3/file1.txt');
      expect(filesToRemove).not.toContain('/folder2/file1.txt');
    });

    it('should not match folders with similar names', () => {
      fileHashes.set('/documents/file1.txt', 'hash1');
      fileHashes.set('/documents-backup/file2.txt', 'hash2');
      fileHashes.set('/docs/file3.txt', 'hash3');
      
      const removedFolders = ['/documents'];
      const filesToRemove = manager.identifyFilesToRemove(fileHashes, removedFolders);
      
      expect(filesToRemove).toHaveLength(1);
      expect(filesToRemove).toContain('/documents/file1.txt');
      expect(filesToRemove).not.toContain('/documents-backup/file2.txt');
      expect(filesToRemove).not.toContain('/docs/file3.txt');
    });

    it('should handle nested folders correctly', () => {
      fileHashes.set('/parent/child1/file1.txt', 'hash1');
      fileHashes.set('/parent/child2/file2.txt', 'hash2');
      fileHashes.set('/parent-other/file3.txt', 'hash3');
      
      const removedFolders = ['/parent'];
      const filesToRemove = manager.identifyFilesToRemove(fileHashes, removedFolders);
      
      expect(filesToRemove).toHaveLength(2);
      expect(filesToRemove).toContain('/parent/child1/file1.txt');
      expect(filesToRemove).toContain('/parent/child2/file2.txt');
      expect(filesToRemove).not.toContain('/parent-other/file3.txt');
    });
  });

  describe('removeFilesFromCache', () => {
    it('should remove files from cache and return count', () => {
      fileHashes.set('/folder1/file1.txt', 'hash1');
      fileHashes.set('/folder2/file1.txt', 'hash2');
      fileHashes.set('/folder2/file2.txt', 'hash3');
      fileHashes.set('/folder3/file1.txt', 'hash4');
      
      const removedFolders = ['/folder2'];
      const count = manager.removeFilesFromCache(fileHashes, removedFolders);
      
      expect(count).toBe(2);
      expect(fileHashes.size).toBe(2);
      expect(fileHashes.has('/folder1/file1.txt')).toBe(true);
      expect(fileHashes.has('/folder3/file1.txt')).toBe(true);
      expect(fileHashes.has('/folder2/file1.txt')).toBe(false);
      expect(fileHashes.has('/folder2/file2.txt')).toBe(false);
    });

    it('should handle removing all files', () => {
      fileHashes.set('/folder1/file1.txt', 'hash1');
      fileHashes.set('/folder1/file2.txt', 'hash2');
      
      const count = manager.removeFilesFromCache(fileHashes, ['/folder1']);
      
      expect(count).toBe(2);
      expect(fileHashes.size).toBe(0);
    });

    it('should return 0 when no files match', () => {
      fileHashes.set('/folder1/file1.txt', 'hash1');
      fileHashes.set('/folder2/file1.txt', 'hash2');
      
      const count = manager.removeFilesFromCache(fileHashes, ['/folder3']);
      
      expect(count).toBe(0);
      expect(fileHashes.size).toBe(2);
    });
  });

  describe('filterPathsInFolders', () => {
    it('should filter paths that belong to removed folders', () => {
      const allPaths = [
        '/folder1/file1.txt',
        '/folder2/file1.txt',
        '/folder2/subfolder/file2.txt',
        '/folder3/file1.txt'
      ];
      
      const removedFolders = ['/folder2'];
      const filtered = manager.filterPathsInFolders(allPaths, removedFolders);
      
      expect(filtered).toHaveLength(2);
      expect(filtered).toContain('/folder2/file1.txt');
      expect(filtered).toContain('/folder2/subfolder/file2.txt');
    });

    it('should handle multiple removed folders', () => {
      const allPaths = [
        '/folder1/file1.txt',
        '/folder2/file1.txt',
        '/folder3/file1.txt',
        '/folder4/file1.txt'
      ];
      
      const removedFolders = ['/folder1', '/folder3'];
      const filtered = manager.filterPathsInFolders(allPaths, removedFolders);
      
      expect(filtered).toHaveLength(2);
      expect(filtered).toContain('/folder1/file1.txt');
      expect(filtered).toContain('/folder3/file1.txt');
    });

    it('should not match partial folder names', () => {
      const allPaths = [
        '/documents/file1.txt',
        '/documents-backup/file2.txt',
        '/docs/file3.txt'
      ];
      
      const removedFolders = ['/documents'];
      const filtered = manager.filterPathsInFolders(allPaths, removedFolders);
      
      expect(filtered).toHaveLength(1);
      expect(filtered).toContain('/documents/file1.txt');
    });

    it('should return empty array when no paths match', () => {
      const allPaths = ['/folder1/file1.txt', '/folder2/file1.txt'];
      const removedFolders = ['/folder3'];
      
      const filtered = manager.filterPathsInFolders(allPaths, removedFolders);
      
      expect(filtered).toHaveLength(0);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete folder removal workflow', () => {
      // Setup initial state
      folderStats.set('/folder1', { total: 5, indexed: 5 });
      folderStats.set('/folder2', { total: 3, indexed: 3 });
      folderStats.set('/folder3', { total: 2, indexed: 2 });
      
      fileHashes.set('/folder1/file1.txt', 'hash1');
      fileHashes.set('/folder1/file2.txt', 'hash2');
      fileHashes.set('/folder2/file1.txt', 'hash3');
      fileHashes.set('/folder2/file2.txt', 'hash4');
      fileHashes.set('/folder3/file1.txt', 'hash5');
      
      // Act: Remove folder2
      const newFolders = ['/folder1', '/folder3'];
      const removedFolders = manager.updateFolderStats(folderStats, newFolders);
      const removedCount = manager.removeFilesFromCache(fileHashes, removedFolders);
      
      // Assert
      expect(removedFolders).toEqual(['/folder2']);
      expect(removedCount).toBe(2);
      expect(folderStats.size).toBe(2);
      expect(folderStats.has('/folder2')).toBe(false);
      expect(fileHashes.size).toBe(3);
      expect(fileHashes.has('/folder2/file1.txt')).toBe(false);
      expect(fileHashes.has('/folder2/file2.txt')).toBe(false);
    });

    it('should handle adding and removing folders simultaneously', () => {
      // Setup
      folderStats.set('/old1', { total: 5, indexed: 5 });
      folderStats.set('/old2', { total: 3, indexed: 3 });
      
      // Act: Remove old folders and add new ones
      const newFolders = ['/new1', '/new2'];
      const removedFolders = manager.updateFolderStats(folderStats, newFolders);
      
      // Assert
      expect(removedFolders).toHaveLength(2);
      expect(removedFolders).toContain('/old1');
      expect(removedFolders).toContain('/old2');
      expect(folderStats.size).toBe(2);
      expect(folderStats.has('/new1')).toBe(true);
      expect(folderStats.has('/new2')).toBe(true);
      expect(folderStats.get('/new1')).toEqual({ total: 0, indexed: 0 });
      expect(folderStats.get('/new2')).toEqual({ total: 0, indexed: 0 });
    });
  });
});