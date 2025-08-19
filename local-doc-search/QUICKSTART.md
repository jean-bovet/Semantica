# Quick Start Guide - Local Document Search

## 🚀 Installation (One Command)

```bash
# Clone and setup
cd local-doc-search
./setup.sh
```

## 📋 Prerequisites

- Python 3.9+ installed
- 4GB RAM (8GB recommended)  
- 2GB free disk space for models

## 🔧 Manual Setup (if setup.sh fails)

```bash
# 1. Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 2. Upgrade pip and install build tools
pip install --upgrade pip setuptools wheel

# 3. Install dependencies
pip install -r requirements.txt

# 4. Create directories
mkdir -p data/documents data/index data/embeddings_cache
```

## 🎯 Basic Usage

### 1. Activate Environment
```bash
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2. Index Your Documents
```bash
# Index a folder
python cli.py index --folder ~/Documents

# Or add a single document
python cli.py add --file document.pdf
```

### 3. Search Your Documents
```bash
# Basic search
python cli.py search "machine learning"

# Interactive mode (recommended!)
python cli.py interactive
```

## 💡 Essential Commands

| Command | Description | Example |
|---------|-------------|---------|
| `index` | Index a folder of documents | `python cli.py index --folder /path/to/docs` |
| `search` | Search for documents | `python cli.py search "quarterly report"` |
| `interactive` | Start interactive search mode | `python cli.py interactive` |
| `stats` | View index statistics | `python cli.py stats` |
| `similar` | Find similar documents | `python cli.py similar --file doc.pdf` |
| `clear` | Clear the index | `python cli.py clear` |
| `setup` | Run configuration wizard | `python cli.py setup` |

## 🎮 Interactive Mode Commands

Once in interactive mode:
- Type any search query
- `stats` - Show index statistics
- `clear` - Clear screen
- `quit` or `exit` - Exit

## 🤖 Using Ollama (Optional)

For potentially better embeddings with local LLMs:

```bash
# 1. Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. Start Ollama
ollama serve

# 3. Pull embedding model
ollama pull nomic-embed-text

# 4. Configure to use Ollama
python cli.py setup
# Choose "ollama" when prompted for embedding type
```

## 📁 Supported File Types

- 📄 PDF files (`.pdf`)
- 📝 Word documents (`.docx`, `.doc`)
- 📋 Text files (`.txt`)
- 📖 Markdown files (`.md`)

## ⚡ Performance Tips

1. **First indexing is slow** - Embeddings are cached for speed
2. **Use batch indexing** - Index entire folders vs individual files
3. **Adjust chunk size** - Edit `config.yaml` for different chunk sizes
4. **Use SSD storage** - Faster disk = faster indexing

## 🔍 Search Tips

- Use **descriptive phrases** instead of single words
- Put **"exact phrases"** in quotes
- Search is **semantic** - finds related concepts, not just keywords
- Results show **relevance scores** (higher = better match)

## 🛠️ Troubleshooting

### "No module named 'faiss'"
```bash
pip install faiss-cpu
```

### Python 3.13 Issues
```bash
# Use flexible version requirements
pip install --upgrade numpy
```

### Ollama Connection Error
```bash
# Make sure Ollama is running
ollama serve

# Check it's working
ollama list
```

### Memory Issues
- Reduce batch size: `python cli.py index --folder /path --batch-size 16`
- Use smaller model in `config.yaml`

## 📊 Example Session

```bash
# 1. Start fresh
$ source venv/bin/activate

# 2. Index your documents
$ python cli.py index --folder ~/Documents/Research
Indexing directory: ~/Documents/Research
Found 42 documents to process
Processing documents: 100%|████████████| 42/42
Added 523 chunks to index
✓ Indexing completed successfully!

# 3. Search interactively
$ python cli.py interactive

Interactive Search Mode
Type 'quit' to exit, 'stats' for statistics

Search: machine learning algorithms

📄 ml_paper.pdf
  Score: 0.8924 - Introduction to supervised learning methods...
  Score: 0.8521 - Deep learning architectures for classification...

📄 notes.docx  
  Score: 0.7812 - Meeting notes on ML project requirements...

Search: stats

Index Statistics:
  Total Documents: 42
  Total Chunks: 523
  Index Size: 523
  
Search: quit
Goodbye!
```

## 🎯 Next Steps

1. **Fine-tune for your needs**: Edit `config.yaml`
2. **Try different models**: Experiment with Ollama models
3. **Build a GUI**: Check the implementation plan for Phase 3
4. **Add more formats**: Extend to support Excel, PowerPoint

## 📚 More Information

- Full documentation: See `README.md`
- Implementation details: See `local-document-search-plan.md`
- Configuration options: Edit `config.yaml`

## 🆘 Getting Help

```bash
# View all commands
python cli.py --help

# Get help for specific command
python cli.py search --help
```

---

**Ready to search!** Your documents are now AI-searchable with semantic understanding. 🎉