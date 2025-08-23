# Documentation Overview

This directory contains technical documentation for the Offline Mac Search application.

## 📚 Available Documentation

### [ARCHITECTURE.md](./ARCHITECTURE.md)
Complete system architecture including:
- Multi-process design
- Component responsibilities
- Data flow diagrams
- File storage structure
- Build system details

### [MEMORY-SOLUTION.md](./MEMORY-SOLUTION.md)
Memory management implementation:
- Process isolation strategy
- Memory leak resolution
- Performance benchmarks
- Configuration options

### [testing-strategy.md](./testing-strategy.md)
Testing approach and optimization:
- Test categorization
- Performance improvements
- Best practices
- CI/CD integration

## 🔗 Related Documentation

### [../specs/complete-specification.md](../specs/complete-specification.md)
Original technical specification for the application.

### [../scripts/](../scripts/)
Benchmarking and utility scripts:
- `ab-embed-benchmark.ts` - Memory benchmarking for embeddings
- `db-ingest-benchmark.ts` - Database performance testing

## 📊 Key Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Memory Usage | ~270MB | Stable after thousands of files |
| Indexing Speed | ~10 files/sec | Depends on file size |
| Search Latency | <100ms | Semantic vector search |
| Supported Formats | 6 | PDF, TXT, MD, DOCX, RTF, DOC |
| Test Coverage | 80%+ | Unit and integration tests |


## 🚀 Quick Links

- [Main README](../README.md) - Getting started and overview
- [Package.json](../package.json) - Dependencies and scripts
- [Tests](../tests/) - Test suite implementation