# Parser Version Tracking System

**Status**: 📋 Planned Enhancement  
**Priority**: High  
**Complexity**: Medium  
**Estimated Effort**: 2-3 days  

## Problem Statement

When parsers are improved or fixed (e.g., adding word-extractor for .doc files), previously processed files don't benefit from the improvements unless users manually re-index everything. This creates a poor upgrade experience and means users miss out on parser improvements.

## Solution Overview

Implement a parser version tracking system that automatically detects when files need re-indexing due to parser improvements.

## Detailed Implementation Plan

### 1. Parser Version Registry

Create a central registry of parser versions:

```typescript
// app/electron/worker/parserVersions.ts
export const PARSER_VERSIONS = {
  pdf: 1,    // Increment when PDF parser improves
  doc: 2,    // Version 2: Added word-extractor support
  docx: 1,   // Version 1: Initial mammoth implementation
  txt: 1,    // Version 1: Basic text parsing
  md: 1,     // Version 1: Markdown as text
  rtf: 1     // Version 1: Basic RTF stripping
};

// Version history tracking for documentation
export const VERSION_HISTORY = {
  pdf: {
    1: "Initial pdf-parse implementation",
    // Future: 2: "Added OCR support for scanned PDFs"
  },
  doc: {
    1: "Attempted to parse as RTF (failed for most files)",
    2: "Proper binary .doc support with word-extractor"
  },
  // ... etc
};
```

### 2. Enhanced Database Schema

Update the file_status table to include parser version:

```typescript
interface FileStatus {
  path: string;
  status: 'indexed' | 'failed' | 'error' | 'queued' | 'outdated';
  parser_version: number;        // NEW: Version of parser used
  chunk_count: number;
  error_message: string;
  last_modified: string;
  indexed_at: string;
  file_hash: string;
  last_retry?: string;           // NEW: For retry logic
}
```

### 3. Smart Re-indexing Logic

```typescript
// app/electron/worker/reindexManager.ts

export function shouldReindex(filePath: string, fileRecord?: FileStatus): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const currentVersion = PARSER_VERSIONS[ext];
  
  if (!currentVersion) {
    return false; // Unsupported file type
  }
  
  // No record = never indexed
  if (!fileRecord) {
    return true;
  }
  
  // File modified since last index
  const currentHash = getFileHash(filePath);
  if (fileRecord.file_hash !== currentHash) {
    return true;
  }
  
  // Parser upgraded
  if (!fileRecord.parser_version || fileRecord.parser_version < currentVersion) {
    console.log(`Parser upgraded for ${ext}: v${fileRecord.parser_version} -> v${currentVersion}`);
    return true;
  }
  
  // Failed files with newer parser available
  if (fileRecord.status === 'failed' || fileRecord.status === 'error') {
    // Retry failed files once per day max
    const lastRetry = fileRecord.last_retry ? new Date(fileRecord.last_retry) : new Date(0);
    const hoursSinceRetry = (Date.now() - lastRetry.getTime()) / (1000 * 60 * 60);
    if (hoursSinceRetry > 24) {
      return true;
    }
  }
  
  return false;
}
```

### 4. Startup Upgrade Check

```typescript
// app/electron/worker/index.ts - Add to initialization

async function checkForParserUpgrades() {
  console.log('Checking for parser upgrades...');
  
  const upgradeSummary: Record<string, number> = {};
  
  for (const [ext, currentVersion] of Object.entries(PARSER_VERSIONS)) {
    // Find outdated files
    const outdatedFiles = await fileStatusTable.query()
      .where(`status = 'indexed'`)
      .toArray()
      .then(files => files.filter(f => {
        const fileExt = path.extname(f.path).slice(1).toLowerCase();
        return fileExt === ext && (!f.parser_version || f.parser_version < currentVersion);
      }));
    
    if (outdatedFiles.length > 0) {
      upgradeSummary[ext] = outdatedFiles.length;
      
      // Queue for re-indexing with high priority
      for (const file of outdatedFiles) {
        // Update status to show it needs update
        await updateFileStatus(file.path, 'outdated', `Parser upgraded to v${currentVersion}`);
        // Add to front of queue
        queue.unshift(file.path);
      }
    }
  }
  
  if (Object.keys(upgradeSummary).length > 0) {
    console.log('Parser upgrades detected:', upgradeSummary);
    // Could notify user through IPC
    parentPort?.postMessage({
      type: 'parser-upgrade',
      payload: upgradeSummary
    });
  }
}
```

### 5. Update File Processing

```typescript
// In handleFile function
async function handleFile(filePath: string) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const parserVersion = PARSER_VERSIONS[ext] || 0;
  
  try {
    // ... existing parsing logic ...
    
    // On successful indexing, record parser version
    await updateFileStatus(filePath, 'indexed', undefined, chunks.length, parserVersion);
    
  } catch (error) {
    // On failure, still record the parser version attempted
    await updateFileStatus(filePath, 'failed', error.message, 0, parserVersion);
  }
}

// Update the updateFileStatus function signature
async function updateFileStatus(
  filePath: string, 
  status: string, 
  error?: string, 
  chunkCount?: number,
  parserVersion?: number  // NEW parameter
) {
  // ... implementation
}
```

### 6. User Interface Enhancements

#### File Search Status Display
```typescript
// Show upgrade available in file search
const getStatusText = (result: FileSearchResult) => {
  switch (result.status) {
    case 'indexed':
      if (result.parser_version < CURRENT_PARSER_VERSIONS[result.ext]) {
        return 'Indexed (update available)';
      }
      return `Indexed (${result.chunks} chunks)`;
    case 'outdated':
      return 'Update available - queued for re-indexing';
    // ... other cases
  }
};
```

#### Settings Panel Addition
```typescript
// New settings options
interface Settings {
  autoUpdateParsers: boolean;      // Auto re-index on parser upgrade
  notifyParserUpgrades: boolean;   // Show notification
  parserUpdatePriority: 'high' | 'normal' | 'low';  // Queue priority
}
```

## Migration Plan

### Phase 1: Initial Implementation
1. Add parser_version field to file_status table
2. Implement version checking logic
3. Set all existing indexed files to version 1
4. Mark all failed .doc files for re-indexing (they'll use v2 parser)

### Phase 2: First Upgrade Test
1. Increment a parser version (e.g., doc from 2 to 3)
2. Verify automatic detection and re-indexing
3. Monitor performance impact

### Phase 3: User Communication
1. Add UI indicators for parser upgrades
2. Show progress separately: "Updating files with improved parser..."
3. Add release notes about parser improvements

## Benefits

1. **Automatic Updates**: Users automatically benefit from parser improvements
2. **Targeted Re-indexing**: Only affected files are reprocessed
3. **Transparent**: Users can see which files have updates available
4. **Efficient**: Minimal performance impact, happens in background
5. **Maintainable**: Just increment version number when improving parser

## Future Extensions

### OCR Support Rollout
When OCR is added for PDFs:
```typescript
PARSER_VERSIONS.pdf = 2; // Triggers re-index of all PDFs
// Add OCR capability detection
if (hasOCRSupport()) {
  PARSER_CAPABILITIES.pdf.ocr = true;
}
```

### Parser Capability Matrix
```typescript
// Future: Track capabilities, not just versions
PARSER_CAPABILITIES = {
  pdf: {
    version: 2,
    features: ['text', 'ocr', 'forms'],
    maxFileSize: 100_000_000
  }
};
```

### Selective Re-indexing
```typescript
// Let users choose what to update
interface UpdateOptions {
  fileTypes: string[];        // Which types to update
  folders: string[];          // Which folders to prioritize
  maxFiles: number;           // Limit for large updates
  schedule: 'now' | 'idle';   // When to perform updates
}
```

## Success Metrics

- Zero user intervention required for parser upgrades
- < 5% performance impact during upgrade re-indexing
- Clear communication of upgrade status
- No data loss during transitions
- Rollback capability if new parser has issues

## Open Questions

1. Should we keep old chunks until new parsing succeeds? (safer but uses more space)
2. How to handle parser downgrades if a new version has bugs?
3. Should we version the embedding model separately?
4. How to communicate parser improvements in release notes?

## Implementation Priority

1. ✅ Core version tracking (Phase 1)
2. ⬜ Automatic re-indexing on startup
3. ⬜ UI status indicators
4. ⬜ Settings for user control
5. ⬜ Metrics and logging
6. ⬜ Rollback mechanism