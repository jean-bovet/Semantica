# Local Document Search Engine

A powerful local document search engine that uses AI to index and search through your documents (PDF, Word, Text) with semantic understanding.

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

- Python 3.9 or higher
- 4GB RAM minimum (8GB recommended)
- 2GB free disk space for models

### Installation

1. Clone the repository:
```bash
cd local-doc-search
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
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
├── cli.py                 # Main CLI interface
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

## Future Enhancements

- [ ] Web UI interface
- [ ] OCR support for scanned PDFs
- [ ] Excel and PowerPoint support
- [ ] Cloud storage integration
- [ ] Multi-language support
- [ ] Query autocomplete

## License

MIT License - feel free to use in your projects!

## Contributing

Contributions welcome! Please feel free to submit pull requests or open issues.