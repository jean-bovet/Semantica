# Local Document Search Engine

A powerful local document search engine that uses AI to index and search through your documents (PDF, Word, Text) with semantic understanding.

**Note**: This search engine is integrated with the FinderSemanticSearch macOS app. For GUI usage, see the main [FSS README](../README.md).

## Features

- 📁 **Multi-format Support**: Index PDF, Word (.docx), text files, and Markdown
- 🤖 **AI-Powered Search**: Semantic search using sentence transformers or Ollama
- 🚀 **Fast Indexing**: Efficient FAISS-based vector search
- 💻 **CLI Interface**: Rich command-line interface with interactive mode
- 🔍 **Smart Chunking**: Intelligent document chunking with overlap
- 📊 **Statistics**: Track index size and document counts
- 🎯 **Similar Documents**: Find documents similar to a reference document

## Quick Start

### Prerequisites

- Python 3.9 or higher (macOS includes Python 3.9+)
- 4GB RAM minimum (8GB recommended)
- 2GB free disk space for models

**For macOS App Users**: The FinderSemanticSearch app handles all dependencies automatically using `cli_standalone.py`.

### Installation

#### Standalone CLI Usage

1. Clone the repository:
```bash
cd local-doc-search
```

2. Use the standalone script (auto-installs dependencies):
```bash
/usr/bin/python3 cli_standalone.py --help
```

#### Manual Installation (Development)

1. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

4. (Optional) For Ollama support:
```bash
# Install Ollama from https://ollama.com
ollama pull nomic-embed-text
```

### Basic Usage

1. **First-time setup** (optional):
```bash
python cli.py setup
```

2. **Index your documents**:
```bash
python cli.py index --folder ~/Documents/MyDocs
```

3. **Search for documents**:
```bash
python cli.py search "quarterly financial report"
```

4. **Interactive mode**:
```bash
python cli.py interactive
```

5. **JSON mode for GUI integration**:
```bash
python cli.py interactive --json-mode
# Now accepts JSON commands on stdin:
# {"action": "index", "folder": "/path/to/docs"}
# {"action": "search", "query": "your query", "limit": 10}
# {"action": "stats"}
# {"action": "exit"}
```

## Command Reference

### Indexing Commands

```bash
# Index a folder of documents
python cli.py index --folder /path/to/documents

# Add a single document
python cli.py add --file /path/to/document.pdf

# Update index with new documents
python cli.py update --folder /path/to/new-documents
```

### Search Commands

```bash
# Basic search
python cli.py search "your search query"

# Search with custom result count
python cli.py search "machine learning" --results 20

# Find similar documents
python cli.py similar --file reference.pdf --results 5

# Interactive search mode
python cli.py interactive
```

### Management Commands

```bash
# View index statistics
python cli.py stats

# Clear the index
python cli.py clear

# Run setup wizard
python cli.py setup
```

## Configuration

Edit `config.yaml` to customize:

```yaml
# Embedding model settings
embedding_model_type: sentence-transformer  # or "ollama"
embedding_model_name: all-MiniLM-L6-v2

# Index location
index_dir: ./data/index

# Processing settings
chunk_size: 1000
chunk_overlap: 200
```

## Model Options

### Sentence Transformers (Default)
- `all-MiniLM-L6-v2` - Fast, good quality (default)
- `all-mpnet-base-v2` - Better quality, slower
- `all-MiniLM-L12-v2` - Balanced

### Ollama Models
- `nomic-embed-text` - High quality embeddings
- `mxbai-embed-large` - Large model, best quality
- `all-minilm` - Ollama version of MiniLM

## Project Structure

```
local-doc-search/
├── cli.py                 # Main CLI interface with JSON mode
├── cli_standalone.py      # Bootstrap script for auto-dependencies
├── config.yaml           # Configuration file
├── requirements.txt      # Python dependencies
├── src/
│   ├── document_processor.py  # Document parsing
│   ├── embeddings.py          # Embedding generation
│   ├── indexer.py            # FAISS index management
│   └── search.py             # Search engine logic
└── data/
    ├── documents/        # Your documents (optional)
    ├── index/           # FAISS index files
    └── embeddings_cache/ # Cached embeddings
```

## macOS App Integration

The search engine is integrated with FinderSemanticSearch.app:

1. **Auto-setup**: `cli_standalone.py` creates a virtual environment at:
   ```
   ~/Library/Application Support/FinderSemanticSearch/venv/
   ```

2. **JSON Protocol**: The app communicates via JSON on stdin/stdout:
   - Commands: index, search, stats, clear, exit
   - Status messages sent to stderr
   - Multiple JSON objects supported for streaming

3. **Bundle Structure**: Python files are copied to:
   ```
   FinderSemanticSearch.app/Contents/Resources/python_cli/
   ```

## Interactive Mode Commands

In interactive mode, you can use:
- Type your search query directly
- `stats` - Show index statistics
- `clear` - Clear the screen
- `quit` or `exit` - Exit interactive mode

## Tips for Better Search Results

1. **Use descriptive queries**: Instead of single words, use phrases
2. **Index quality documents**: Clean, well-formatted documents give better results
3. **Adjust chunk size**: Smaller chunks for precise search, larger for context
4. **Regular updates**: Re-index periodically for best results

## Troubleshooting

### "No module named 'faiss'"
```bash
pip install faiss-cpu
```

### Ollama connection error
```bash
# Make sure Ollama is running
ollama serve

# Pull the required model
ollama pull nomic-embed-text
```

### Out of memory errors
- Reduce batch size: `python cli.py index --folder /path --batch-size 16`
- Use smaller model: Edit config.yaml to use `all-MiniLM-L6-v2`

## Performance

- Indexing speed: ~100-500 documents/minute (depends on size)
- Search speed: <100ms for most queries
- Memory usage: ~1-2GB for typical document sets

## JSON Mode API

When using `--json-mode`, the CLI accepts and returns JSON:

### Commands
```json
{"action": "index", "folder": "/path/to/folder"}
{"action": "search", "query": "search text", "limit": 10}
{"action": "stats"}
{"action": "clear"}
{"action": "exit"}
```

### Responses
```json
{"success": true, "action": "index", "total_documents": 50, "total_chunks": 500}
{"success": true, "action": "search", "results": [{"file_name": "doc.pdf", "score": 0.95, "preview": "..."}]}
{"success": true, "action": "stats", "stats": {"total_documents": 50, "total_chunks": 500}}
```

## Future Enhancements

- [x] macOS GUI interface (FinderSemanticSearch app)
- [x] Auto-dependency installation
- [x] JSON streaming support
- [ ] OCR support for scanned PDFs
- [ ] Excel and PowerPoint support
- [ ] Cloud storage integration
- [ ] Multi-language support
- [ ] Query autocomplete

## License

MIT License - feel free to use in your projects!

## Contributing

Contributions welcome! Please feel free to submit pull requests or open issues.