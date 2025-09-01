# Semantica Documentation

Welcome to the technical documentation for Semantica, an offline semantic search application for macOS.

## 📚 Documentation Structure

### Core Specifications

| Document | Description | Status |
|----------|-------------|--------|
| [01-overview.md](./01-overview.md) | Product vision, features, and current status | ✅ Current |
| [02-architecture.md](./02-architecture.md) | System design, components, and data flow | ✅ Current |
| [03-implementation.md](./03-implementation.md) | Technical details, memory management, parsers | ✅ Current |
| [04-operations.md](./04-operations.md) | Troubleshooting, monitoring, deployment | ✅ Current |
| [05-api-reference.md](./05-api-reference.md) | API documentation, schemas, configuration | ✅ Current |
| [06-build-optimization.md](./06-build-optimization.md) | Build system, optimization, two-package architecture | ✅ Current |
| [07-signing-distribution.md](./07-signing-distribution.md) | Code signing, notarization, distribution | ✅ Current |
| [08-startup-flow.md](./08-startup-flow.md) | Detailed startup sequence and model download flow | ✅ Current |

### Archived Documentation

| Document | Description | Status |
|----------|-------------|--------|
| [archive/complete-specification-v2.md](./archive/complete-specification-v2.md) | Original comprehensive spec | 📦 Archived |

### Related Documentation

| Location | Contents |
|----------|----------|
| [../planning/](../planning/) | Future feature proposals and enhancements |
| [../docs/](../docs/) | Additional guides and analysis |
| [../CLAUDE.md](../CLAUDE.md) | AI assistant context and guidelines |

## 🚀 Quick Start

### For New Users
Start with [01-overview.md](./01-overview.md) to understand the product and its capabilities.

### For Developers
1. Read [02-architecture.md](./02-architecture.md) for system design
2. Review [03-implementation.md](./03-implementation.md) for code details
3. Reference [05-api-reference.md](./05-api-reference.md) for APIs

### For Operations
Jump to [04-operations.md](./04-operations.md) for troubleshooting and maintenance.

## 📊 System Status Dashboard

### Implementation Status

| Component | Status | Version | Notes |
|-----------|--------|---------|-------|
| **Core Architecture** | ✅ Production | 1.0 | Multi-process with memory isolation |
| **File Parsers** | ✅ Production | Mixed | PDF v1, DOC v2, DOCX v1, RTF v1, TXT v4, MD v4, CSV v1, TSV v1, Excel v1 |
| **Parser Versioning** | ✅ Production | 1.0 | Automatic re-indexing on upgrades |
| **Search Engine** | ✅ Production | 1.0 | Multilingual E5 model |
| **UI Framework** | ✅ Production | 1.0 | React with search-first design |
| **Memory Management** | ✅ Production | 4.0 | EmbedderPool with auto-restart |
| **Error Recovery** | ✅ Production | 1.0 | Auto-restart and retry logic |

### Performance Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| **Memory Usage** | <2GB | ~1.8GB | ✅ Optimized |
| **Search Latency** | <100ms | ~50ms | ✅ Excellent |
| **Indexing Speed** | >1 file/s | ~2 files/s | ✅ Exceeds target |
| **Crash Rate** | 0% | 0% | ✅ Stable |

### Known Limitations

| Issue | Impact | Workaround | Fix Status |
|-------|--------|------------|------------|
| Scanned PDFs | No text extraction | Use OCR tools first | 🔄 Planned |
| Large files (>50MB) | May timeout | Split files | ⚠️ Low priority |
| Encrypted files | Cannot index | Decrypt first | ❌ Won't fix |

## 🔄 Recent Updates

### 2025-09-01
- ✅ Implemented EmbedderPool for 2x throughput improvement
- ✅ Added CPU-aware concurrency (adapts to system resources)
- ✅ Created performance profiling system
- ✅ Fixed all ESLint errors and warnings
- ✅ Updated all documentation to match implementation

### 2025-08-30
- ✅ Added multi-encoding support for text files (UTF-8, UTF-16, ISO-8859-1, Windows-1252, Mac Roman)
- ✅ Fixed garbled text issues with legacy files
- ✅ Updated text and markdown parsers to v4

### 2025-08-28
- ✅ Renamed app to "Semantica" throughout codebase
- ✅ Fixed all documentation inconsistencies
- ✅ Standardized memory limits and paths
- ✅ Added navigation links to all specs
- ✅ Removed duplicate content between docs
- ✅ Organized build and distribution documentation

### 2025-08-24
- ✅ Implemented parser version tracking system
- ✅ Added automatic re-indexing for upgraded parsers
- ✅ Reorganized documentation into modular structure
- ✅ Updated DOC parser to v2 with word-extractor

### 2025-08-23
- ✅ Created search-first UI design
- ✅ Added file search capability
- ✅ Implemented multi-lingual support

## 🛠 Development Guidelines

### Documentation Standards
- Use ALL CAPS for standard files: `README.md`, `CLAUDE.md`
- Use lowercase-with-hyphens for specs: `01-overview.md`
- Keep each file focused and under 500 lines
- Update status dashboard when making changes

### Code Conventions
- TypeScript with strict typing
- Functional React components
- Absolute imports from `@/`
- Test coverage >85%

### Contributing
1. Read relevant specs before making changes
2. Update documentation alongside code
3. Maintain backwards compatibility
4. Test parser version upgrades

## 📈 Roadmap

### In Progress 🚧
- UI status indicators for parser upgrades
- Settings for user control over re-indexing

### Planned 📋
- OCR support for scanned documents
- Cloud storage integration
- Advanced search operators
- Export search results

### Future 🔮
- Mobile companion app
- Team collaboration features
- AI-powered summaries

## 🔗 Quick Links

### User Resources
- [Troubleshooting Guide](./04-operations.md#troubleshooting-common-issues)
- [Installation Instructions](./04-operations.md#installation-instructions)
- [Performance Tuning](./04-operations.md#performance-tuning)

### Developer Resources
- [API Reference](./05-api-reference.md)
- [Build Instructions](./04-operations.md#building-for-production)
- [Testing Strategy](./03-implementation.md#testing-strategy)

### Support
- GitHub Issues: Bug reports and feature requests
- GitHub Discussions: Community support
- Logs: `~/Library/Logs/Semantica/`

## 📝 Document Maintenance

### Review Schedule
- **Weekly**: Status dashboard, known issues
- **Monthly**: Performance metrics, roadmap
- **Quarterly**: Full documentation review

### Version History
- **v3.0** (2025-08-24): Modular documentation structure
- **v2.0** (2025-08): Parser versioning, memory optimization
- **v1.0** (2025-07): Initial release

---

*For detailed information, start with [01-overview.md](./01-overview.md) or jump to the section most relevant to your needs.*