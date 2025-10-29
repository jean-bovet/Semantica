# Integration Testing Strategy for FSS

## Overview

This document outlines a comprehensive integration testing strategy for Semantica. Unlike unit tests that isolate individual components, these integration tests validate the complete user experience and system interactions.

## Why Integration Tests Over Unit Tests for FSS

The worker component is particularly difficult to unit test due to:
- **Multiple heavy dependencies** (LanceDB, ML models, file watchers, child processes)
- **Async message-passing architecture** between processes
- **Stateful queue processing** with infinite loops and global state
- **File system side effects** that are hard to mock
- **Platform-specific behaviors** in file watching and process management

Integration tests provide better value by testing real user scenarios with actual components.

## Proposed Test Suite

### 1. Critical User Journey Tests (Priority 1)

#### First-time User Setup
- Test model download on first launch
- Verify download dialog and progress
- Ensure app becomes usable after setup

#### Document Indexing Flow
- Create test folders with sample files (PDF, TXT, DOCX, DOC, RTF)
- Select folder in app and verify progress bar
- Wait for indexing completion
- Verify file count matches expected

#### Search Functionality
- Index known test documents
- Search for specific terms
- Verify correct documents returned
- Validate relevance ranking

### 2. File Processing Pipeline (Priority 1)

#### Mixed Document Processing
```javascript
// Test folder structure:
test-documents/
  ├── report.pdf
  ├── notes.txt
  ├── presentation.docx
  ├── old-doc.doc
  ├── readme.md
  ├── data.rtf
  └── image.jpg  // Should be skipped
```
- Verify only supported files are indexed
- Ensure search works across all file types
- Validate chunk generation and vector storage

#### File Change Detection
- Index initial files
- Modify files and verify re-indexing
- Ensure old chunks are removed
- Test file deletion handling

### 3. Memory and Performance Tests (Priority 2)

#### Large-scale Indexing
- Handle 1000+ files without crashing
- Monitor memory usage stays under 500MB growth
- Verify embedder process auto-restart after threshold
- Ensure no data loss during restarts

#### Resource Management
- Test cleanup of temporary files
- Verify database compaction
- Monitor file handle limits

### 4. Error Recovery Tests (Priority 2)

#### Corrupted File Handling
- Include corrupted PDFs, invalid DOCXs
- Verify other files still index successfully
- Check error logging without crashes
- Test retry mechanism for failed files

#### Database Recovery
- Simulate database corruption
- Verify app rebuilds database
- Ensure can index new files after recovery
- Test migration from older versions

### 5. Search Quality Tests (Priority 3)

#### Relevance Ranking
- Test exact match prioritization
- Verify semantic similarity scoring
- Test phrase search vs keyword search

#### Multilingual Support
- Index documents in different languages
- Verify cross-language semantic search
- Test special characters and Unicode

## Test Infrastructure

### Test Harness Architecture

```javascript
class TestApp {
  async launch(options = {}) {
    this.app = await electron.launch({
      args: ['--test-mode'],
      env: { 
        TEST_DB: tempDir(),
        SKIP_MODEL_DOWNLOAD: options.skipModel,
        MODEL_CACHE: './test-fixtures/models'
      }
    });
  }

  async indexFolder(path) {
    // Trigger folder indexing via IPC
  }

  async search(query) {
    // Execute search and return results
  }

  async cleanup() {
    await this.app.close();
    await cleanupTestFiles();
  }
}
```

### Test Data Organization

```
tests/integration/
├── fixtures/
│   ├── documents/
│   │   ├── small-set/      # 5-10 files for quick tests
│   │   ├── large-set/       # 100+ files for performance tests
│   │   ├── multilingual/    # Various language documents
│   │   └── edge-cases/      # Corrupted, empty, special chars
│   └── models/
│       └── cached/          # Pre-downloaded model for CI
├── specs/
│   ├── user-journey.spec.ts
│   ├── file-processing.spec.ts
│   ├── performance.spec.ts
│   ├── error-recovery.spec.ts
│   └── search-quality.spec.ts
└── helpers/
    ├── app-launcher.ts
    ├── test-data-generator.ts
    └── assertions.ts
```

## Implementation Plan

### Phase 1: Essential Tests (1-2 days)
1. Set up test infrastructure with Playwright Electron
2. Implement core user journey tests
3. Add file processing pipeline tests
4. Create reusable test fixtures

### Phase 2: CI Integration (1 day)
1. Configure GitHub Actions workflow
2. Cache model files for faster CI runs
3. Set up test result reporting
4. Add performance benchmarking

### Phase 3: Advanced Tests (Optional)
1. Memory profiling and leak detection
2. Search quality metrics
3. Cross-platform testing (Windows, Linux)
4. Accessibility testing

## CI/CD Configuration

```yaml
name: Integration Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Cache models
        uses: actions/cache@v3
        with:
          path: test-fixtures/models
          key: models-${{ hashFiles('package-lock.json') }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build app
        run: npm run build
      
      - name: Run integration tests
        run: npm run test:integration
        timeout-minutes: 15
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results-${{ matrix.os }}
          path: test-results/
```

## Tools and Dependencies

### Required Packages
- **@playwright/test** - Modern Electron testing framework
- **electron-playwright** - Playwright Electron adapter
- **tmp** - Temporary directory management
- **faker** - Test data generation
- **pdf-lib** - Generate test PDFs
- **docx** - Generate test Word documents

### Alternative Tools
- **Spectron** - Classic Electron testing (deprecated but stable)
- **WebdriverIO** - Cross-platform automation
- **Robot Framework** - Keyword-driven testing

## Success Metrics

1. **Coverage**: Test all critical user paths
2. **Reliability**: <1% flaky test rate
3. **Speed**: Full suite runs in <15 minutes
4. **Maintainability**: Tests require <2 hours/month maintenance
5. **Value**: Catch 90% of user-facing bugs before release

## Benefits Over Unit Testing

1. **Tests real user scenarios** - Not isolated functions
2. **Catches integration bugs** - Between worker, UI, and database
3. **Validates performance** - Memory leaks, speed regressions
4. **Less mocking complexity** - Uses real components
5. **Platform-specific testing** - Catches OS-specific issues
6. **Better ROI** - More bugs caught per test written

## Next Steps

1. Review and approve this testing strategy
2. Set up basic integration test infrastructure
3. Implement Phase 1 essential tests
4. Add to CI pipeline
5. Gradually expand test coverage based on bug patterns

## Notes

- Integration tests complement, not replace, existing unit tests
- Focus on user-visible behavior, not implementation details
- Keep tests deterministic by controlling test data
- Run tests in isolated environments to prevent pollution
- Monitor test execution time and optimize as needed