import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileWatcherService } from '../../../src/main/worker/services/file-watcher-service';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * FileWatcherService Unit Tests
 * 
 * Testing with REAL file system events - NO MOCKING
 * Uses temporary directories and real file operations
 */

describe('FileWatcherService', () => {
  let service: FileWatcherService;
  let tempDir: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));
    service = new FileWatcherService();
  });

  afterEach(async () => {
    // Clean up watcher and temp directory
    await service.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Watcher Lifecycle', () => {
    test('should start watching directories', async () => {
      await expect(
        service.start([tempDir])
      ).resolves.not.toThrow();

      expect(service.isReady()).toBe(false); // Not ready immediately
      
      // Wait for ready state
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(service.isReady()).toBe(true);
    });

    test('should handle non-existent directories gracefully', async () => {
      const nonExistent = path.join(tempDir, 'does-not-exist');
      
      await service.start([nonExistent, tempDir]);
      
      // Should only watch the existing directory
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(service.isReady()).toBe(true);
    });

    test('should stop watching', async () => {
      await service.start([tempDir]);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(service.isReady()).toBe(true);
      
      await service.stop();
      expect(service.isReady()).toBe(false);
    });

    test('should handle multiple start/stop cycles', async () => {
      // First cycle
      await service.start([tempDir]);
      await new Promise(resolve => setTimeout(resolve, 100));
      await service.stop();
      
      // Second cycle
      await service.start([tempDir]);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(service.isReady()).toBe(true);
    });

    test('should handle empty roots array', async () => {
      await service.start([]);
      
      // Should not crash, just warn
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(service.isReady()).toBe(false);
    });
  });

  describe('File Events', () => {
    test('should detect file additions', async () => {
      const testFile = path.join(tempDir, 'test.txt');

      let addDetected = false;
      service.on('add', (filePath) => {
        if (filePath === testFile) {
          addDetected = true;
        }
      });

      await service.start([tempDir]);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create file after watcher is ready
      fs.writeFileSync(testFile, 'test content');

      // Wait for add event
      await new Promise(resolve => setTimeout(resolve, 2500));

      expect(addDetected).toBe(true);
    }, 5000);

    test('should detect file changes', async () => {
      const testFile = path.join(tempDir, 'change.txt');

      // Create file before watching
      fs.writeFileSync(testFile, 'initial content');

      let changeDetected = false;
      service.on('change', (filePath) => {
        if (filePath === testFile) {
          changeDetected = true;
        }
      });

      await service.start([tempDir]);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Modify file after watcher is ready
      fs.appendFileSync(testFile, '\nmore content');

      // Wait for change event
      await new Promise(resolve => setTimeout(resolve, 2500));

      expect(changeDetected).toBe(true);
    }, 5000);

    test('should detect file deletions', async () => {
      const testFile = path.join(tempDir, 'delete.txt');

      // Create file before watching
      fs.writeFileSync(testFile, 'delete me');

      let deleteDetected = false;
      service.on('unlink', (filePath) => {
        if (filePath === testFile) {
          deleteDetected = true;
        }
      });

      await service.start([tempDir]);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Delete file after watcher is ready
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }

      // Wait for delete event
      await new Promise(resolve => setTimeout(resolve, 2500));

      expect(deleteDetected).toBe(true);
    }, 5000);

    test('should handle multiple file operations', async () => {
      const addedFiles: string[] = [];
      const changedFiles: string[] = [];
      const deletedFiles: string[] = [];
      
      service.on('add', (file) => addedFiles.push(file));
      service.on('change', (file) => changedFiles.push(file));
      service.on('unlink', (file) => deletedFiles.push(file));
      
      await service.start([tempDir]);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Perform multiple operations
      const file1 = path.join(tempDir, 'file1.txt');
      const file2 = path.join(tempDir, 'file2.txt');
      
      fs.writeFileSync(file1, 'content1');
      fs.writeFileSync(file2, 'content2');
      
      await new Promise(resolve => setTimeout(resolve, 2500)); // Wait for events
      
      fs.appendFileSync(file1, ' updated');
      
      await new Promise(resolve => setTimeout(resolve, 2500)); // Wait for change
      
      fs.unlinkSync(file2);
      
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for delete
      
      expect(addedFiles).toContain(file1);
      expect(addedFiles).toContain(file2);
      expect(changedFiles).toContain(file1);
      expect(deletedFiles).toContain(file2);
    }, 10000);
  });

  describe('Exclude Patterns', () => {
    test('should respect exclude patterns', async () => {
      const capturedFiles: string[] = [];
      
      service.on('add', (file) => capturedFiles.push(file));
      
      await service.start([tempDir], ['*.log', 'node_modules']);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Create various files
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'include');
      fs.writeFileSync(path.join(tempDir, 'test.log'), 'exclude');
      
      const nodeModulesDir = path.join(tempDir, 'node_modules');
      fs.mkdirSync(nodeModulesDir);
      fs.writeFileSync(path.join(nodeModulesDir, 'package.json'), 'exclude');
      
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Should only capture the .txt file
      expect(capturedFiles).toHaveLength(1);
      expect(capturedFiles[0]).toContain('test.txt');
    }, 5000);

    test('should handle complex patterns', async () => {
      const capturedFiles: string[] = [];
      
      service.on('add', (file) => capturedFiles.push(file));
      
      // Exclude hidden files and specific extensions
      await service.start([tempDir], ['.*', '**/*.tmp', '**/build/**']);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Create test structure
      fs.writeFileSync(path.join(tempDir, 'visible.txt'), 'include');
      fs.writeFileSync(path.join(tempDir, '.hidden'), 'exclude');
      fs.writeFileSync(path.join(tempDir, 'temp.tmp'), 'exclude');
      
      const buildDir = path.join(tempDir, 'build');
      fs.mkdirSync(buildDir);
      fs.writeFileSync(path.join(buildDir, 'output.js'), 'exclude');
      
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Should only capture visible.txt
      expect(capturedFiles).toHaveLength(1);
      expect(capturedFiles[0]).toContain('visible.txt');
    }, 5000);
  });

  describe('Event Management', () => {
    test('should add and remove event handlers', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      service.on('add', handler1);
      service.on('add', handler2);
      
      await service.start([tempDir]);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'content');
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      
      // Remove one handler
      service.off('add', handler1);
      handler1.mockClear();
      handler2.mockClear();
      
      fs.writeFileSync(path.join(tempDir, 'test2.txt'), 'content');
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    }, 10000);

    test('should handle multiple event types', async () => {
      const addHandler = vi.fn();
      const changeHandler = vi.fn();
      const unlinkHandler = vi.fn();
      
      service.on('add', addHandler);
      service.on('change', changeHandler);
      service.on('unlink', unlinkHandler);
      
      await service.start([tempDir]);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const testFile = path.join(tempDir, 'multi.txt');
      
      // Add
      fs.writeFileSync(testFile, 'initial');
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Change
      fs.appendFileSync(testFile, ' changed');
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Delete
      fs.unlinkSync(testFile);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      expect(addHandler).toHaveBeenCalled();
      expect(changeHandler).toHaveBeenCalled();
      expect(unlinkHandler).toHaveBeenCalled();
    }, 10000);
  });

  describe('Watched Paths', () => {
    test('should return watched paths', async () => {
      const dir1 = path.join(tempDir, 'dir1');
      const dir2 = path.join(tempDir, 'dir2');
      
      fs.mkdirSync(dir1);
      fs.mkdirSync(dir2);
      
      await service.start([dir1, dir2]);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const watched = service.getWatchedPaths();
      
      // Should include both directories
      expect(watched.some(p => p.includes('dir1'))).toBe(true);
      expect(watched.some(p => p.includes('dir2'))).toBe(true);
    });
  });

  describe('Scan for Changes', () => {
    test('should scan for changes (placeholder)', async () => {
      await service.start([tempDir]);
      
      const result = await service.scanForChanges();
      
      expect(result).toEqual({
        newFiles: [],
        modifiedFiles: [],
        skippedFiles: []
      });
    });
  });

  describe('Performance', () => {
    test('should handle rapid file creation efficiently', async () => {
      const fileCount = 50;
      const capturedFiles: string[] = [];
      
      service.on('add', (file) => capturedFiles.push(file));
      
      await service.start([tempDir]);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const startTime = Date.now();
      
      // Rapidly create files
      for (let i = 0; i < fileCount; i++) {
        fs.writeFileSync(path.join(tempDir, `file${i}.txt`), `content${i}`);
      }
      
      // Wait for all events to be captured
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const duration = Date.now() - startTime;
      
      // Should capture all files
      expect(capturedFiles).toHaveLength(fileCount);
      
      // Should complete within reasonable time (5 seconds for 50 files)
      expect(duration).toBeLessThan(5000);
    }, 10000);
  });

  describe('Edge Cases', () => {
    test('should handle subdirectory creation', async () => {
      const subdirFiles: string[] = [];
      
      service.on('add', (file) => subdirFiles.push(file));
      
      await service.start([tempDir]);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Create subdirectory and file
      const subdir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(subdir, 'nested.txt'), 'nested content');
      
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Should detect the nested file
      expect(subdirFiles.some(f => f.includes('nested.txt'))).toBe(true);
    }, 5000);

    test('should handle symbolic links', async () => {
      const linkTarget = path.join(tempDir, 'target.txt');
      const linkPath = path.join(tempDir, 'link.txt');
      
      fs.writeFileSync(linkTarget, 'target content');
      
      const capturedFiles: string[] = [];
      service.on('add', (file) => capturedFiles.push(file));
      
      await service.start([tempDir]);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Create symlink
      fs.symlinkSync(linkTarget, linkPath);
      
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Should detect the symlink
      expect(capturedFiles.some(f => f.includes('link.txt'))).toBe(true);
    }, 5000);
  });
});

/**
 * This test suite demonstrates:
 * 
 * 1. REAL FILE SYSTEM - Uses actual file system operations
 * 2. NO MOCKING - All events come from real file changes
 * 3. TEMPORAL ISOLATION - Each test gets its own directory
 * 4. EVENT-DRIVEN - Tests async events with real timing
 * 5. COMPREHENSIVE - Tests all watcher functionality
 * 6. PERFORMANCE - Validates handling of rapid operations
 * 
 * Note: Some tests use timeouts to wait for file system events.
 * This is necessary for real file watching but tests still complete quickly.
 */