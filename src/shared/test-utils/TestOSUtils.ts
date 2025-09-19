/**
 * Test OS utilities for testing.
 * Provides deterministic OS operations without actual system dependencies.
 */
export class TestOSUtils {
  private homeDir: string;

  constructor(homeDir = '/test/home/user') {
    this.homeDir = homeDir;
  }

  /**
   * Get home directory (configurable for tests)
   */
  homedir(): string {
    return this.homeDir;
  }

  /**
   * Set home directory for testing
   */
  setHomeDir(path: string): void {
    this.homeDir = path;
  }
}

/**
 * Test path utilities for testing.
 * Provides consistent path operations across platforms.
 */
export class TestPathUtils {
  private separator: string;

  constructor(separator = '/') {
    this.separator = separator;
  }

  /**
   * Join paths
   */
  join(...paths: string[]): string {
    return paths
      .filter(path => path && path.length > 0)
      .map(path => path.replace(/[/\\]+/g, this.separator))
      .join(this.separator)
      .replace(/[/\\]+/g, this.separator);
  }

  /**
   * Get directory name
   */
  dirname(path: string): string {
    const normalizedPath = path.replace(/[/\\]+/g, this.separator);
    const lastSepIndex = normalizedPath.lastIndexOf(this.separator);

    if (lastSepIndex <= 0) {
      return '.';
    }

    return normalizedPath.substring(0, lastSepIndex);
  }

  /**
   * Get path separator
   */
  get sep(): string {
    return this.separator;
  }

  /**
   * Set path separator for testing different platforms
   */
  setSeparator(separator: string): void {
    this.separator = separator;
  }
}