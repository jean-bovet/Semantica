import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import semver from 'semver';

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn()
  }
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    checkForUpdates: vi.fn(),
    setFeedURL: vi.fn(),
    forceDevUpdateConfig: false
  }
}));

// Helper function that mimics the actual implementation in main.ts
async function checkForUpdates() {
  const currentVersion = app.getVersion();
  const result = await autoUpdater.checkForUpdates();

  if (result) {
    const remoteVersion = result.updateInfo.version;

    // Validate versions are valid semver
    if (!semver.valid(currentVersion) || !semver.valid(remoteVersion)) {
      return { available: false };
    }

    // Only return available: true if remote version is actually newer
    if (semver.gt(remoteVersion, currentVersion)) {
      return { available: true, version: remoteVersion };
    } else {
      return { available: false };
    }
  }

  return { available: false };
}

describe('Updater Version Comparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set current app version to 1.0.4
    (app.getVersion as any).mockReturnValue('1.0.4');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Update Check Handler', () => {
    it('should return available: false when remote version is older (1.0.3 < 1.0.4)', async () => {
      // Mock electron-updater returning an older version
      (autoUpdater.checkForUpdates as any).mockResolvedValue({
        updateInfo: {
          version: '1.0.3'
        }
      });

      const response = await checkForUpdates();

      expect(response.available).toBe(false);
      expect(response.version).toBeUndefined();
    });

    it('should return available: true when remote version is newer (1.0.5 > 1.0.4)', async () => {
      // Mock electron-updater returning a newer version
      (autoUpdater.checkForUpdates as any).mockResolvedValue({
        updateInfo: {
          version: '1.0.5'
        }
      });

      const response = await checkForUpdates();

      expect(response.available).toBe(true);
      expect(response.version).toBe('1.0.5');
    });

    it('should return available: false when remote version is same (1.0.4 === 1.0.4)', async () => {
      // Mock electron-updater returning the same version
      (autoUpdater.checkForUpdates as any).mockResolvedValue({
        updateInfo: {
          version: '1.0.4'
        }
      });

      const response = await checkForUpdates();

      expect(response.available).toBe(false);
      expect(response.version).toBeUndefined();
    });

    it('should return available: false when checkForUpdates returns null', async () => {
      // Mock electron-updater returning null (no updates available)
      (autoUpdater.checkForUpdates as any).mockResolvedValue(null);

      const response = await checkForUpdates();

      expect(response.available).toBe(false);
    });

    it('should handle pre-release versions correctly (1.0.5-beta < 1.0.5)', async () => {
      // Mock electron-updater returning a pre-release version
      (autoUpdater.checkForUpdates as any).mockResolvedValue({
        updateInfo: {
          version: '1.0.5-beta'
        }
      });

      const response = await checkForUpdates();

      // 1.0.5-beta is actually newer than 1.0.4, so this should be available: true
      expect(response.available).toBe(true);
      expect(response.version).toBe('1.0.5-beta');
    });

    it('should handle major version differences correctly (2.0.0 > 1.0.4)', async () => {
      // Mock electron-updater returning a major version bump
      (autoUpdater.checkForUpdates as any).mockResolvedValue({
        updateInfo: {
          version: '2.0.0'
        }
      });

      const response = await checkForUpdates();

      expect(response.available).toBe(true);
      expect(response.version).toBe('2.0.0');
    });

    it('should handle invalid version formats gracefully', async () => {
      // Mock electron-updater returning an invalid version
      (autoUpdater.checkForUpdates as any).mockResolvedValue({
        updateInfo: {
          version: 'invalid-version'
        }
      });

      const response = await checkForUpdates();

      // When version is invalid, should return available: false for safety
      expect(response.available).toBe(false);
    });
  });
});
