import { describe, it, expect } from 'vitest';
import { getEnabledExtensions, getDefaultFileTypes } from '../../../src/main/parsers/registry';

/**
 * Test for config timing bug where configManager is null during startWatching()
 *
 * Root cause: Module-level variables in worker/index.ts are populated AFTER
 * startWatching() is called during initialization, causing configManager to be null.
 *
 * Impact: When configManager is null, the fallback `|| {}` results in empty object,
 * which causes getEnabledExtensions({}) to return [], filtering out all files.
 */
describe('Config Timing Bug - getEnabledExtensions', () => {
  it('DEMONSTRATES BUG: returns empty array when given empty object (simulating null configManager)', () => {
    // This simulates what happens when configManager is null:
    // configManager?.getSettings().fileTypes returns undefined
    // Falls back to {} via || {}
    const emptyFileTypes = {};

    const result = getEnabledExtensions(emptyFileTypes);

    // BUG: This returns empty array, causing scan to find 0 files
    expect(result).toEqual([]);
    expect(result.length).toBe(0);
  });

  it('EXPECTED: should return default extensions when configManager has defaults', () => {
    // This is what SHOULD happen during initialization
    const defaultFileTypes = getDefaultFileTypes();

    const result = getEnabledExtensions(defaultFileTypes);

    // Should contain all default-enabled extensions
    expect(result.length).toBeGreaterThan(0);

    // Verify common extensions are present (without dot prefix)
    expect(result).toContain('pdf');
    expect(result).toContain('txt');
    expect(result).toContain('docx');
    expect(result).toContain('md');
  });

  it('VERIFIES FIX: getDefaultFileTypes() provides proper fallback instead of {}', () => {
    // After fix, the fallback should be getDefaultFileTypes() instead of {}
    const fallbackValue = getDefaultFileTypes(); // This is what the fix should use
    const wrongFallbackValue = {}; // This is what the current code uses

    const resultWithFix = getEnabledExtensions(fallbackValue);
    const resultWithBug = getEnabledExtensions(wrongFallbackValue);

    // With fix: should have extensions
    expect(resultWithFix.length).toBeGreaterThan(0);
    expect(resultWithFix).toContain('pdf');

    // With bug: has no extensions
    expect(resultWithBug.length).toBe(0);

    // Demonstrate the fix solves the problem
    expect(resultWithFix).not.toEqual(resultWithBug);
  });

  it('DOCUMENTS BEHAVIOR: getDefaultFileTypes returns all default-enabled parsers', () => {
    const defaults = getDefaultFileTypes();

    // Should be a non-empty object
    expect(defaults).toBeDefined();
    expect(Object.keys(defaults).length).toBeGreaterThan(0);

    // Common parsers should be enabled by default (check for existence, value might vary)
    expect('pdf' in defaults).toBe(true);
    expect('txt' in defaults).toBe(true);
    expect('docx' in defaults).toBe(true);
    expect('md' in defaults).toBe(true);
  });
});

/**
 * Integration-style test showing the full flow
 */
describe('Config Timing Bug - Initialization Flow', () => {
  it('DEMONSTRATES BUG SCENARIO: null configManager during scan setup', () => {
    // Simulate the code path in worker/index.ts:629-630
    const configManager = null; // This is the actual state during early initialization

    // Line 629: const fileTypes = configManager?.getSettings().fileTypes || {};
    const fileTypes = configManager?.getSettings?.()?.fileTypes || {};

    // Line 630: const supportedExtensions = getEnabledExtensions(fileTypes);
    const supportedExtensions = getEnabledExtensions(fileTypes);

    // BUG DEMONSTRATED: supportedExtensions is empty
    expect(fileTypes).toEqual({});
    expect(supportedExtensions).toEqual([]);
    expect(supportedExtensions.length).toBe(0);
  });

  it('EXPECTED BEHAVIOR: should use defaults when configManager is null', () => {
    // Simulate the FIXED code path
    const configManager = null;

    // FIXED Line 629: const fileTypes = configManager?.getSettings().fileTypes || getDefaultFileTypes();
    const fileTypes = configManager?.getSettings?.()?.fileTypes || getDefaultFileTypes();

    const supportedExtensions = getEnabledExtensions(fileTypes);

    // EXPECTED: supportedExtensions contains default extensions
    expect(Object.keys(fileTypes).length).toBeGreaterThan(0);
    expect(supportedExtensions.length).toBeGreaterThan(0);
    expect(supportedExtensions).toContain('pdf');
    expect(supportedExtensions).toContain('txt');
  });
});
