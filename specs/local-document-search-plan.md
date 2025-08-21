# Local Document Search Engine - Implementation Plan

## Status: ✅ COMPLETED

## Project Overview
Built a local document search engine that uses ML models to index and search through documents (PDF, Word, Text) in specified folders. Users can enter natural language queries and receive semantically relevant documents with preview snippets.

## Technology Stack Decision

### Recommended: Python
**Reasons:**
- **Mature ecosystem** for document processing (PyPDF2, python-docx, python-pptx)
- **Best-in-class ML libraries** (FAISS, sentence-transformers, langchain)
- **Ollama integration** is well-documented and stable
- **Easier transition** to macOS app using PyQt or Tkinter
- **Performance** with vectorized operations via NumPy
- **Community support** for AI/ML tasks

### Alternative: TypeScript
- Better for web-based UI later
- Requires more setup for document processing
- Less mature ecosystem for vector databases

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  User Interface                  │
│              (CLI → GUI in Phase 3)              │
└─────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────┐
│                 Search Engine                    │
│         (Query Processing & Ranking)             │
└─────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────┐
│              Vector Database                     │
│              (FAISS or ChromaDB)                 │
└─────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────┐
│           Document Processor                     │
│    (PDF, Word, Text parsing & chunking)         │
└─────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────┐
│              Embedding Model                     │
│     (Sentence Transformers via Ollama)          │
└─────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Core CLI Tool (Week 1-2)

#### Setup & Dependencies
```bash
# Core dependencies
pip install faiss-cpu
pip install sentence-transformers
pip install ollama
pip install langchain
pip install PyPDF2
pip install python-docx
pip install click  # for CLI
pip install rich   # for better terminal output
```

#### Project Structure
```
local-doc-search/
├── src/
│   ├── __init__.py
│   ├── document_processor.py    # Document parsing
│   ├── embeddings.py            # Embedding generation
│   ├── indexer.py               # FAISS index management
│   ├── search.py                # Search logic
│   └── cli.py                   # CLI interface
├── data/
│   ├── documents/               # Source documents
│   └── index/                   # Stored indexes
├── config.yaml                  # Configuration
├── requirements.txt
└── README.md
```

#### Core Components

1. **Document Processor** (`document_processor.py`)
   - Parse PDF files using PyPDF2
   - Parse Word documents using python-docx
   - Parse plain text files
   - Chunk documents into manageable segments (512-1024 tokens)
   - Maintain document metadata (filename, page number, chunk position)

2. **Embedding Generator** (`embeddings.py`)
   - Use Ollama with local models (e.g., llama2, mistral)
   - Generate embeddings for document chunks
   - Batch processing for efficiency
   - Cache embeddings to avoid reprocessing

3. **Index Manager** (`indexer.py`)
   - Create FAISS index for vector similarity search
   - Save/load indexes to disk
   - Update index when new documents are added
   - Remove documents from index

4. **Search Engine** (`search.py`)
   - Convert user query to embedding
   - Perform similarity search in FAISS
   - Rank results by relevance score
   - Return top-k documents with metadata

5. **CLI Interface** (`cli.py`)
   ```bash
   # Index a folder
   python cli.py index --folder /path/to/documents
   
   # Search for documents
   python cli.py search "quarterly financial report"
   
   # Update index with new documents
   python cli.py update --folder /path/to/documents
   
   # Clear index
   python cli.py clear
   ```

### Phase 2: Enhanced Features (Week 3)

1. **Advanced Search Features**
   - Hybrid search (semantic + keyword matching)
   - Filter by document type or date
   - Search within specific documents
   - Fuzzy matching for typos

2. **Performance Optimizations**
   - Incremental indexing (only process new/modified files)
   - Multi-threading for document processing
   - Compression for stored indexes
   - Memory-mapped index loading

3. **Better Results Presentation**
   - Show relevant excerpts with highlighting
   - Confidence scores for matches
   - Group results by document
   - Export results to CSV/JSON

### Phase 3: macOS GUI Application (Week 4-5)

#### Technology Options

1. **Native macOS (Recommended for App Store)**
   - Swift UI with Python backend via PyObjC
   - Or use py2app for distribution

2. **Cross-platform Desktop**
   - Electron + FastAPI backend
   - PyQt6 or Tkinter (simpler but less modern)
   - Tauri (Rust-based, lightweight)

#### GUI Features
- Drag-and-drop folder selection
- Real-time indexing progress
- Search-as-you-type with debouncing
- Document preview pane
- Settings panel for model selection
- System tray integration

## Technical Considerations

### Ollama Setup
```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a suitable model
ollama pull llama2  # or mistral, phi, etc.

# For embeddings, consider:
ollama pull nomic-embed-text  # Specialized embedding model
```

### Vector Database Options

1. **FAISS (Recommended for start)**
   - Fast, efficient, well-documented
   - Good for datasets up to millions of vectors
   - Supports various index types

2. **ChromaDB (Alternative)**
   - Built for LLM applications
   - Includes metadata filtering
   - Simpler API but heavier

3. **Qdrant (For scaling)**
   - Better for production
   - REST API
   - Cloud-ready

### Model Selection

1. **For Embeddings:**
   - `sentence-transformers/all-MiniLM-L6-v2` (Fast, good quality)
   - `nomic-ai/nomic-embed-text-v1` (Via Ollama)
   - `BAAI/bge-small-en-v1.5` (Excellent quality/size ratio)

2. **For Reranking (Optional):**
   - `cross-encoder/ms-marco-MiniLM-L-6-v2`

## Development Workflow

### Week 1: Foundation
- [ ] Set up Python environment and install dependencies
- [ ] Implement document parsing for PDF and text
- [ ] Create basic embedding generation with Ollama
- [ ] Build FAISS index creation and storage

### Week 2: CLI Tool
- [ ] Implement search functionality
- [ ] Create CLI interface with Click
- [ ] Add configuration management
- [ ] Test with sample documents

### Week 3: Enhancements
- [ ] Add Word document support
- [ ] Implement incremental indexing
- [ ] Improve search ranking algorithm
- [ ] Add result highlighting

### Week 4: GUI Planning
- [ ] Design UI mockups
- [ ] Choose GUI framework
- [ ] Create basic window with search interface
- [ ] Integrate with backend

### Week 5: GUI Completion
- [ ] Add folder selection and indexing UI
- [ ] Implement document preview
- [ ] Create settings panel
- [ ] Package for distribution

## Testing Strategy

1. **Unit Tests**
   - Document parsing accuracy
   - Embedding generation consistency
   - Search result relevance

2. **Integration Tests**
   - End-to-end indexing workflow
   - Search across multiple document types
   - Index persistence and loading

3. **Performance Tests**
   - Indexing speed for large folders
   - Search response time
   - Memory usage with large indexes

## Future Enhancements

1. **Advanced Features**
   - OCR for scanned PDFs
   - Support for more formats (Excel, PowerPoint, Markdown)
   - Multi-language support
   - Smart summarization of results

2. **Integration**
   - Spotlight integration on macOS
   - Cloud sync for indexes
   - API for third-party apps
   - Browser extension

3. **AI Enhancements**
   - Question-answering instead of just search
   - Document clustering and categorization
   - Automatic tagging and metadata extraction
   - Related document suggestions

## Getting Started

### Prerequisites
1. Python 3.9+ installed
2. Ollama installed and running
3. At least 4GB RAM (8GB recommended)
4. 2GB free disk space for models

### Quick Start
```bash
# Clone the repo (once created)
git clone [your-repo-url]
cd local-doc-search

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Download Ollama model
ollama pull nomic-embed-text

# Run first index
python cli.py index --folder ~/Documents/test-folder

# Search
python cli.py search "your search query"
```

## Estimated Timeline

- **Week 1-2:** Functional CLI tool with basic search
- **Week 3:** Enhanced features and optimizations
- **Week 4-5:** Basic macOS GUI application
- **Week 6+:** Polish, testing, and distribution

## Key Decisions to Make

1. **Embedding Model**: Start with sentence-transformers or use Ollama exclusively?
2. **GUI Framework**: Native Swift or Python-based for faster development?
3. **Distribution**: App Store vs direct download?
4. **Index Storage**: Local only or cloud sync option?

## Resources

- [FAISS Documentation](https://github.com/facebookresearch/faiss)
- [Ollama Documentation](https://ollama.com/docs)
- [Sentence Transformers](https://www.sbert.net/)
- [LangChain for LLM Apps](https://python.langchain.com/)
- [PyQt6 for Desktop Apps](https://www.riverbankcomputing.com/software/pyqt/)

## Next Steps

1. Review and approve this plan
2. Set up development environment
3. Create GitHub repository
4. Start with Phase 1 implementation
5. Weekly progress reviews and adjustments