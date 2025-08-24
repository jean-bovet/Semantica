# Technical Specifications

This folder contains the technical specifications and implementation details for the Offline Mac Search application.

## Core Specifications

### [ARCHITECTURE.md](./ARCHITECTURE.md)
Complete system architecture documentation including:
- Multi-process design with Electron, Worker Thread, and Embedder Child Process
- Memory isolation strategy
- Data flow and indexing pipeline
- File storage structure and database schema
- Security features and error handling
- Search-first UI philosophy

### [MEMORY-SOLUTION.md](./MEMORY-SOLUTION.md)
Memory management solution that resolved critical memory leaks:
- Process isolation architecture
- Memory monitoring and thresholds
- Automatic restart mechanisms
- Performance benchmarks showing stable 270MB usage
- Configuration options for memory limits

### [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
Comprehensive troubleshooting guide:
- Common issues and solutions
- Scanned PDF handling
- Database recovery procedures
- Performance optimization tips
- Debug commands and log locations

## Key Design Decisions

### Process Architecture
- **Main Process**: Manages app lifecycle and IPC
- **Worker Thread**: Owns database and handles indexing
- **Embedder Child Process**: Isolated for memory safety

### Database Design
- **LanceDB** for vector storage
- **file_status table** for tracking indexing state
- **config.json** for user preferences

### File Processing
- **Concurrent limit**: 5 files maximum
- **Chunk size**: 500 tokens with 60 token overlap
- **Memory limits**: RSS 900MB, External 150MB
- **Auto-restart**: After 200 files or memory threshold

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Core Architecture | ✅ Complete | Multi-process with memory isolation |
| File Parsers | ✅ Complete | PDF, DOCX, DOC, RTF, TXT, MD |
| Search Engine | ✅ Complete | Multilingual E5 model |
| UI Framework | ✅ Complete | React with search-first design |
| File Status Tracking | ✅ Complete | Database persistence |
| Memory Management | ✅ Complete | Stable at ~270MB |
| Error Recovery | ✅ Complete | Auto-restart and retry logic |

## Performance Specifications

### Indexing Performance
- **File Discovery**: Parallel via Chokidar
- **Processing**: 5 concurrent files
- **Embedding**: Batches of 8 chunks
- **Memory Throttling**: Reduces parallelism at 800MB RSS

### Search Performance
- **Query Time**: <100ms for vector search
- **Result Limit**: 100 results default
- **Debouncing**: 300ms for UI queries
- **Index Creation**: Deferred until idle

### Memory Limits
- **Worker Process**: 1500MB RSS max
- **Embedder Process**: 300MB external max
- **Restart Triggers**: 500 files or memory limits
- **Stable Operation**: ~270MB typical usage

## File Format Support

| Format | Parser | Status | Notes |
|--------|--------|--------|-------|
| PDF | pdf-parse | ✅ Working | Text-based only, scanned PDFs fail |
| DOCX | mammoth | ✅ Working | Modern Word format |
| DOC | word-extractor | ✅ Working | Legacy Word format |
| RTF | Custom | ✅ Working | Basic RTF stripping |
| TXT | fs.readFile | ✅ Working | Plain text |
| MD | fs.readFile | ✅ Working | Markdown as text |

## Related Documentation

- [Planning](../planning/) - Future enhancement proposals
- [Documentation](../docs/) - Analysis and guides
- [Tests](../tests/) - Test suite specifications