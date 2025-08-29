import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from '../../src/main/worker/config';

describe('Bundle Exclusion', () => {
  let tempDir: string;
  let configManager: ConfigManager;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
    configManager = new ConfigManager(tempDir);
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('ConfigManager', () => {
    it('should have bundle exclusion enabled by default', () => {
      const config = configManager.getConfig();
      expect(config.settings.excludeBundles).toBe(true);
    });

    it('should include default macOS bundle patterns', () => {
      const config = configManager.getConfig();
      expect(config.settings.bundlePatterns).toContain('**/*.app/**');
      expect(config.settings.bundlePatterns).toContain('**/*.framework/**');
      expect(config.settings.bundlePatterns).toContain('**/*.bundle/**');
      expect(config.settings.bundlePatterns).toContain('**/*.kext/**');
      expect(config.settings.bundlePatterns).toContain('**/*.xcodeproj/**');
      expect(config.settings.bundlePatterns).toContain('**/*.photoslibrary/**');
    });

    it('should merge bundle patterns with exclude patterns when enabled', () => {
      const effectivePatterns = configManager.getEffectiveExcludePatterns();
      
      // Should include default exclude patterns
      expect(effectivePatterns).toContain('node_modules');
      expect(effectivePatterns).toContain('.git');
      expect(effectivePatterns).toContain('*.tmp');
      expect(effectivePatterns).toContain('.DS_Store');
      
      // Should include bundle patterns
      expect(effectivePatterns).toContain('**/*.app/**');
      expect(effectivePatterns).toContain('**/*.framework/**');
    });

    it('should not include bundle patterns when disabled', () => {
      // Disable bundle exclusion
      configManager.updateSettings({ excludeBundles: false });
      
      const effectivePatterns = configManager.getEffectiveExcludePatterns();
      
      // Should include default exclude patterns
      expect(effectivePatterns).toContain('node_modules');
      expect(effectivePatterns).toContain('.git');
      
      // Should NOT include bundle patterns
      expect(effectivePatterns).not.toContain('**/*.app/**');
      expect(effectivePatterns).not.toContain('**/*.framework/**');
    });

    it('should persist bundle exclusion settings', () => {
      // Update settings
      configManager.updateSettings({
        excludeBundles: false,
        bundlePatterns: ['**/*.custom/**']
      });
      
      // Create new config manager instance to test persistence
      const newConfigManager = new ConfigManager(tempDir);
      const config = newConfigManager.getConfig();
      
      expect(config.settings.excludeBundles).toBe(false);
      expect(config.settings.bundlePatterns).toContain('**/*.custom/**');
    });
  });

  describe('Bundle Detection Logic', () => {
    // Helper function to simulate the isInsideBundle logic
    function isInsideBundle(filePath: string, bundlePatterns: string[]): boolean {
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

    it('should detect files inside .app bundles', () => {
      const patterns = configManager.getConfig().settings.bundlePatterns;
      
      expect(isInsideBundle('/Applications/SDL-X (x86-64).app/Contents/MacOS/SDL', patterns)).toBe(true);
      expect(isInsideBundle('/Users/test/MyApp.app/Contents/Resources/data.txt', patterns)).toBe(true);
      expect(isInsideBundle('/Applications/Xcode.app/Contents/Developer/file.txt', patterns)).toBe(true);
    });

    it('should detect files inside .framework bundles', () => {
      const patterns = configManager.getConfig().settings.bundlePatterns;
      
      expect(isInsideBundle('/System/Library/Frameworks/Python.framework/Versions/3.9/lib/python3.9', patterns)).toBe(true);
      expect(isInsideBundle('/Library/Frameworks/SDL2.framework/Headers/SDL.h', patterns)).toBe(true);
    });

    it('should detect files inside other bundle types', () => {
      const patterns = configManager.getConfig().settings.bundlePatterns;
      
      expect(isInsideBundle('/Users/test/Project.xcodeproj/project.pbxproj', patterns)).toBe(true);
      expect(isInsideBundle('/Users/test/Photos.photoslibrary/database/photos.db', patterns)).toBe(true);
      expect(isInsideBundle('/System/Library/Extensions/IOUSBFamily.kext/Contents/Info.plist', patterns)).toBe(true);
      expect(isInsideBundle('/Library/PreferencePanes/Flash.prefPane/Contents/MacOS/Flash', patterns)).toBe(true);
    });

    it('should not detect regular files and directories', () => {
      const patterns = configManager.getConfig().settings.bundlePatterns;
      
      expect(isInsideBundle('/Users/test/Documents/report.pdf', patterns)).toBe(false);
      expect(isInsideBundle('/Users/test/Desktop/notes.txt', patterns)).toBe(false);
      expect(isInsideBundle('/Users/test/Downloads/image.png', patterns)).toBe(false);
      expect(isInsideBundle('/Users/test/project/src/index.ts', patterns)).toBe(false);
    });

    it('should handle edge cases', () => {
      const patterns = configManager.getConfig().settings.bundlePatterns;
      
      // File with .app in name but not a bundle
      expect(isInsideBundle('/Users/test/myapp.application.txt', patterns)).toBe(false);
      
      // Directory that looks like a bundle but isn't
      expect(isInsideBundle('/Users/test/not.app.really/file.txt', patterns)).toBe(false);
      
      // Nested bundles
      expect(isInsideBundle('/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS.simruntime/Contents/Resources/RuntimeRoot/System/Library/Frameworks/UIKit.framework/UIKit', patterns)).toBe(true);
    });
  });

  describe('Pattern Format', () => {
    it('should use correct glob patterns for chokidar', () => {
      const patterns = configManager.getConfig().settings.bundlePatterns;
      
      // All patterns should follow the **/*.ext/** format
      patterns.forEach(pattern => {
        expect(pattern).toMatch(/^\*\*\/\*\.[^/]+\/\*\*$/);
      });
    });

    it('should cover all common macOS bundle types', () => {
      const patterns = configManager.getConfig().settings.bundlePatterns;
      const expectedExtensions = [
        'app', 'framework', 'bundle', 'plugin', 'kext',
        'prefPane', 'qlgenerator', 'dSYM', 'xcodeproj',
        'playground', 'photoslibrary', 'musiclibrary'
      ];
      
      expectedExtensions.forEach(ext => {
        const pattern = `**/*.${ext}/**`;
        expect(patterns.some(p => p === pattern || p === `**/*.${ext.toLowerCase()}/**`)).toBe(true);
      });
    });
  });
});