import { describe, it, expect } from 'vitest';
import { 
  getStatusText, 
  isIndexerActive, 
  normalizeProgress,
  type ProgressState 
} from '../../src/renderer/utils/statusHelpers';

describe('Status Helpers', () => {
  describe('getStatusText', () => {
    it('should show initializing when not initialized', () => {
      const progress: ProgressState = {
        queued: 0,
        processing: 0,
        done: 0,
        errors: 0,
        paused: false,
        initialized: false
      };
      
      expect(getStatusText(progress)).toBe('⏳ Initializing...');
    });

    it('should show initializing when initialized is undefined', () => {
      const progress: ProgressState = {
        queued: 0,
        processing: 0,
        done: 0,
        errors: 0,
        paused: false
        // initialized is undefined
      };
      
      expect(getStatusText(progress)).toBe('⏳ Initializing...');
    });

    it('should show paused when paused regardless of other state', () => {
      const progress: ProgressState = {
        queued: 10,
        processing: 2,
        done: 5,
        errors: 0,
        paused: true,
        initialized: true
      };
      
      expect(getStatusText(progress)).toBe('⏸ Paused');
    });

    it('should show indexing with count when files are queued', () => {
      const progress: ProgressState = {
        queued: 10,
        processing: 0,
        done: 0,
        errors: 0,
        paused: false,
        initialized: true
      };
      
      expect(getStatusText(progress)).toBe('⚡ Indexing (10 remaining)');
    });

    it('should show indexing with count when files are processing', () => {
      const progress: ProgressState = {
        queued: 0,
        processing: 3,
        done: 0,
        errors: 0,
        paused: false,
        initialized: true
      };
      
      expect(getStatusText(progress)).toBe('⚡ Indexing (3 remaining)');
    });

    it('should show total remaining when both queued and processing', () => {
      const progress: ProgressState = {
        queued: 10,
        processing: 3,
        done: 50,
        errors: 2,
        paused: false,
        initialized: true
      };
      
      expect(getStatusText(progress)).toBe('⚡ Indexing (13 remaining)');
    });

    it('should show ready when no files are pending', () => {
      const progress: ProgressState = {
        queued: 0,
        processing: 0,
        done: 100,
        errors: 0,
        paused: false,
        initialized: true
      };
      
      expect(getStatusText(progress)).toBe('✓ Ready');
    });

    it('should show ready even with errors if nothing is pending', () => {
      const progress: ProgressState = {
        queued: 0,
        processing: 0,
        done: 95,
        errors: 5,
        paused: false,
        initialized: true
      };
      
      expect(getStatusText(progress)).toBe('✓ Ready');
    });

    describe('priority order', () => {
      it('should prioritize not initialized over everything', () => {
        const progress: ProgressState = {
          queued: 10,
          processing: 5,
          done: 0,
          errors: 0,
          paused: true, // Even when paused
          initialized: false
        };
        
        expect(getStatusText(progress)).toBe('⏳ Initializing...');
      });

      it('should prioritize paused over indexing', () => {
        const progress: ProgressState = {
          queued: 10,
          processing: 5,
          done: 0,
          errors: 0,
          paused: true,
          initialized: true
        };
        
        expect(getStatusText(progress)).toBe('⏸ Paused');
      });
    });
  });

  describe('isIndexerActive', () => {
    it('should return true when files are queued', () => {
      const progress: ProgressState = {
        queued: 1,
        processing: 0,
        done: 0,
        errors: 0,
        paused: false,
        initialized: true
      };
      
      expect(isIndexerActive(progress)).toBe(true);
    });

    it('should return true when files are processing', () => {
      const progress: ProgressState = {
        queued: 0,
        processing: 1,
        done: 0,
        errors: 0,
        paused: false,
        initialized: true
      };
      
      expect(isIndexerActive(progress)).toBe(true);
    });

    it('should return true when both queued and processing', () => {
      const progress: ProgressState = {
        queued: 5,
        processing: 2,
        done: 0,
        errors: 0,
        paused: false,
        initialized: true
      };
      
      expect(isIndexerActive(progress)).toBe(true);
    });

    it('should return false when idle', () => {
      const progress: ProgressState = {
        queued: 0,
        processing: 0,
        done: 100,
        errors: 0,
        paused: false,
        initialized: true
      };
      
      expect(isIndexerActive(progress)).toBe(false);
    });

    it('should return false when idle even if not initialized', () => {
      const progress: ProgressState = {
        queued: 0,
        processing: 0,
        done: 0,
        errors: 0,
        paused: false,
        initialized: false
      };
      
      expect(isIndexerActive(progress)).toBe(false);
    });
  });

  describe('normalizeProgress', () => {
    it('should preserve initialized when true', () => {
      const progress: ProgressState = {
        queued: 0,
        processing: 0,
        done: 0,
        errors: 0,
        paused: false,
        initialized: true
      };
      
      const normalized = normalizeProgress(progress);
      expect(normalized.initialized).toBe(true);
    });

    it('should preserve initialized when false', () => {
      const progress: ProgressState = {
        queued: 0,
        processing: 0,
        done: 0,
        errors: 0,
        paused: false,
        initialized: false
      };
      
      const normalized = normalizeProgress(progress);
      expect(normalized.initialized).toBe(false);
    });

    it('should default initialized to false when undefined', () => {
      const progress: ProgressState = {
        queued: 0,
        processing: 0,
        done: 0,
        errors: 0,
        paused: false
        // initialized is undefined
      };
      
      const normalized = normalizeProgress(progress);
      expect(normalized.initialized).toBe(false);
    });

    it('should preserve all other fields', () => {
      const progress: ProgressState = {
        queued: 10,
        processing: 5,
        done: 100,
        errors: 2,
        paused: true,
        initialized: true
      };
      
      const normalized = normalizeProgress(progress);
      expect(normalized).toEqual({
        queued: 10,
        processing: 5,
        done: 100,
        errors: 2,
        paused: true,
        initialized: true
      });
    });
  });
});