# Documentation Overview

This directory contains analysis and implementation documentation for the Offline Mac Search application.

## 📁 Documentation Structure

### `/docs/` - Current Implementation Analysis
- **[multilingual-search-strategy.md](./multilingual-search-strategy.md)** - Implemented multilingual search with E5 model
- **[search-quality-analysis.md](./search-quality-analysis.md)** - Current search quality metrics and chunking strategy

### `/specs/` - Technical Specifications
- **[ARCHITECTURE.md](../specs/ARCHITECTURE.md)** - System architecture and design
- **[MEMORY-SOLUTION.md](../specs/MEMORY-SOLUTION.md)** - Memory management implementation
- **[TROUBLESHOOTING.md](../specs/TROUBLESHOOTING.md)** - Common issues and solutions

### `/planning/` - Future Enhancements
- **[parser-version-tracking.md](../planning/parser-version-tracking.md)** - Automatic re-indexing system
- **[core-logic-testing-plan.md](../planning/core-logic-testing-plan.md)** - Comprehensive testing strategy
- **[test-coverage-gaps.md](../planning/test-coverage-gaps.md)** - Testing gap analysis
- **[testing-strategy.md](../planning/testing-strategy.md)** - Test optimization approach
- **[testing-implementation-summary.md](../planning/testing-implementation-summary.md)** - Testing implementation details

## 📊 Current System Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Memory Usage | ~270MB | Stable after thousands of files |
| Indexing Speed | 5 files concurrent | Memory-safe processing |
| Search Latency | <100ms | Semantic vector search |
| Supported Formats | 6 | PDF, TXT, MD, DOCX, RTF, DOC |
| Test Coverage | 85%+ | 81 tests, 3.3s execution |
| Language Support | 100+ | Multilingual E5 model |

## 🔍 Key Features

### Implemented
- ✅ Multilingual search (French + English)
- ✅ Memory-isolated embedding process
- ✅ File status tracking in database
- ✅ Legacy .doc file support
- ✅ Search-first UI philosophy
- ✅ Single instance lock

### Known Limitations
- ⚠️ Scanned PDFs require OCR (not supported)
- ⚠️ Large archives may require manual chunking
- ⚠️ Password-protected files not supported

## 🚀 Quick Links

- [Main README](../README.md) - Getting started and overview
- [Package.json](../package.json) - Dependencies and scripts
- [Tests](../tests/) - Test suite implementation
- [Planning](../planning/) - Future enhancement proposals
- [Specs](../specs/) - Technical specifications