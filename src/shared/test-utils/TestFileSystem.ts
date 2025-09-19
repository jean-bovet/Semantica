/**
 * Simple in-memory file system for testing.
 * Provides deterministic file operations without actual file system access.
 */
export class TestFileSystem {
  private files: Map<string, { content: string; size: number }> = new Map();
  private directories: Set<string> = new Set();

  /**
   * Check if a file exists
   */
  existsSync(path: string): boolean {
    return this.files.has(path);
  }

  /**
   * Get file stats (size)
   */
  statSync(path: string): { size: number } {
    const file = this.files.get(path);
    if (!file) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }
    return { size: file.size };
  }

  /**
   * Create directories
   */
  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    if (options?.recursive) {
      // For recursive, just mark the path as created
      this.directories.add(path);
    } else {
      this.directories.add(path);
    }
  }

  /**
   * Add a file to the test file system
   */
  addFile(path: string, content: string): void {
    this.files.set(path, {
      content,
      size: Buffer.byteLength(content, 'utf8')
    });
  }

  /**
   * Add a file with specific size
   */
  addFileWithSize(path: string, size: number): void {
    this.files.set(path, {
      content: 'test content',
      size
    });
  }

  /**
   * Remove a file
   */
  removeFile(path: string): void {
    this.files.delete(path);
  }

  /**
   * Clear all files and directories
   */
  clear(): void {
    this.files.clear();
    this.directories.clear();
  }

  /**
   * Get all files for debugging
   */
  getAllFiles(): string[] {
    return Array.from(this.files.keys());
  }
}