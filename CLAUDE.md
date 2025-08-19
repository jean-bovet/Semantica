# Local Document Search Project - Claude Context

## Project Overview
Building a local document search engine that uses AI to index and search documents (PDF, Word, Text) with semantic understanding. The project has two main phases:
1. **Phase 1** (COMPLETED): Python CLI tool with local LLM capabilities
2. **Phase 2** (PLANNED): Native macOS app with SwiftUI interface

## Repository Structure

```
/Users/bovet/GitHub/FSS/
├── CLAUDE.md                    # This file - project context for Claude
├── LICENSE                      # Project license
├── README.md                    # Main project documentation
│
├── specs/                       # 📋 SPECIFICATIONS & PLANNING
│   ├── local-document-search-plan.md   # Original implementation plan
│   ├── SWIFTUI_PYTHON_GUIDE.md        # Guide for native macOS app approach
│   └── ML_DOWNLOAD_STRATEGY.md        # Analysis of model bundling strategies
│
└── local-doc-search/           # 💻 PYTHON CLI IMPLEMENTATION
    ├── cli.py                  # Main CLI interface
    ├── config.yaml             # Configuration file
    ├── requirements.txt        # Python dependencies
    ├── setup.sh               # One-click setup script
    ├── .gitignore             # Git ignore rules
    │
    ├── src/                   # Source code
    │   ├── document_processor.py  # Document parsing (PDF, Word, Text)
    │   ├── embeddings.py          # Embedding generation (Ollama/Transformers)
    │   ├── indexer.py             # FAISS index management
    │   └── search.py              # Search engine logic
    │
    ├── data/                  # Data directory (git-ignored)
    │   ├── documents/         # Sample documents for testing
    │   ├── index/            # FAISS index files
    │   └── embeddings_cache/ # Cached embeddings
    │
    ├── venv/                 # Python virtual environment (git-ignored)
    │
    └── docs/                 # Additional documentation
        ├── README.md             # CLI tool documentation
        ├── QUICKSTART.md        # Quick start guide
        └── SECURITY_ANALYSIS.md # Read-only guarantees analysis
```

## Current Status

### ✅ Completed (Phase 1)
- Python CLI tool with rich interface
- Document processing for PDF, Word, Text files
- Dual embedding support (Sentence Transformers + Ollama)
- FAISS vector indexing for fast search
- Interactive search mode
- Comprehensive error handling
- Read-only document guarantees
- Setup automation script

### 🚧 In Progress
- Testing and refinement of CLI tool
- Documentation improvements

### 📅 Planned (Phase 2)
- Native macOS app using SwiftUI + PyObjC
- Bundled Python runtime (no user installation needed)
- App Store distribution
- GUI with drag-and-drop indexing
- Background model downloads

## Key Files to Know

### Implementation Files
- `local-doc-search/cli.py` - Entry point, all CLI commands
- `local-doc-search/src/search.py` - Main search engine class
- `local-doc-search/src/document_processor.py` - Handles all document parsing
- `local-doc-search/src/embeddings.py` - ML model integration

### Documentation Files
- `specs/local-document-search-plan.md` - Original detailed plan
- `specs/SWIFTUI_PYTHON_GUIDE.md` - Native app implementation guide
- `specs/ML_DOWNLOAD_STRATEGY.md` - Model distribution analysis
- `local-doc-search/SECURITY_ANALYSIS.md` - Security/privacy guarantees

### Configuration
- `local-doc-search/config.yaml` - User configuration
- `local-doc-search/requirements.txt` - Python dependencies
- `local-doc-search/.gitignore` - Excludes data/, venv/, caches

## Quick Commands

### Setup & Installation
```bash
cd local-doc-search
./setup.sh                           # One-click setup
source venv/bin/activate            # Activate environment
```

### Using the CLI
```bash
python cli.py index --folder ~/Documents    # Index documents
python cli.py search "machine learning"     # Search
python cli.py interactive                   # Interactive mode
python cli.py stats                        # View statistics
python cli.py --help                       # All commands
```

### Development
```bash
# Run tests on sample document
python cli.py index --folder data/documents
python cli.py search "machine learning"

# Check specific module
python src/document_processor.py    # Has test code in __main__
python src/embeddings.py            # Has test code in __main__
```

## Technical Stack

### Current (CLI)
- **Language**: Python 3.9+
- **ML Models**: Sentence Transformers, Ollama
- **Vector DB**: FAISS
- **Document Processing**: PyPDF2, python-docx
- **CLI**: Click + Rich
- **Dependencies**: ~20 packages, 300MB installed

### Planned (macOS App)
- **UI**: SwiftUI (native macOS)
- **Bridge**: PyObjC
- **Distribution**: py2app for bundling
- **Size**: ~400MB with embedded Python + models

## Important Decisions Made

1. **Python over TypeScript** - Better ML ecosystem
2. **FAISS over ChromaDB** - Lighter, faster, sufficient
3. **Hybrid model approach** - Bundle small model, download better ones
4. **Read-only design** - Never modifies user documents
5. **CLI first** - Validate approach before GUI

## Known Issues & Limitations

1. **PDF Warnings** - Some complex PDFs show warnings (handled gracefully)
2. **Text Encoding** - Some files with special characters may fail (skipped)
3. **Bundle Size** - Full app will be 400-500MB with models
4. **Python 3.13** - Had compatibility issues, fixed with flexible requirements

## Next Steps

### Immediate
- [ ] Test with larger document sets
- [ ] Optimize indexing performance
- [ ] Add more document formats (Excel, Markdown)

### Phase 2 Prerequisites
- [ ] Learn SwiftUI basics
- [ ] Set up Xcode project
- [ ] Create py2app configuration
- [ ] Design app UI mockups

## Environment Details
- **Working Directory**: `/Users/bovet/GitHub/FSS/local-doc-search`
- **Platform**: macOS (Darwin)
- **Python**: 3.13 (with compatibility fixes)
- **Git Branch**: main

## Notes for Claude

### When Working on CLI
- Always activate venv first: `source venv/bin/activate`
- Test changes with sample document in `data/documents/`
- Maintain read-only guarantees for user documents
- Keep error messages visible (users want to see them)

### When Planning macOS App
- Refer to `specs/SWIFTUI_PYTHON_GUIDE.md` for architecture
- Consider `specs/ML_DOWNLOAD_STRATEGY.md` for model distribution
- Target bundle size: <500MB
- Must work offline after installation

### Code Style
- No comments unless requested
- Short, direct responses
- Show errors/warnings to user
- Use existing patterns in codebase

## Contact & Resources
- GitHub repo: [to be created]
- Based on: https://github.com/hemanthgk10/Gen-AI-Local-Search
- Ollama: https://ollama.com