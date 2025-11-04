# Python Setup Guide

This guide explains how to set up Python and its dependencies for Semantica's embedding service.

## Prerequisites

Semantica requires:
- **Python 3.9 or later** (3.9, 3.10, or 3.11 recommended)
- **pip** (Python package installer)
- **2.2 GB free disk space** for dependencies

### System Dependencies for OCR

If you want to use the OCR feature for scanned PDFs, you also need:

- **Poppler** - PDF rendering utilities required by pdf2image

**Installation (macOS):**
```bash
brew install poppler
```

**Verification:**
```bash
which pdfinfo && which pdftoppm
# Should output paths like /opt/homebrew/bin/pdfinfo
```

**What this provides:**
- `pdfinfo` - Extracts PDF page count and metadata
- `pdftoppm` - Converts PDF pages to images for OCR processing

**Note:** Without poppler, OCR will fail with "Unable to get page count" errors.

## Quick Setup (Recommended)

Install Python dependencies globally using your system Python:

```bash
python3 -m pip install -r embedding_sidecar/requirements.txt
```

**That's it!** The app uses your system Python installation.

## Installation Methods

### Option A: System-wide Installation (Recommended)

**Pros:**
- Simple one-command setup
- Works out of the box with the app
- No virtual environment management needed

**Steps:**

1. **Install dependencies:**
   ```bash
   python3 -m pip install -r embedding_sidecar/requirements.txt
   ```

2. **Verify installation:**
   ```bash
   python3 embedding_sidecar/check_deps.py
   ```
   Should output: `{"all_present": true, ...}`

### Option B: Virtual Environment (Alternative)

**Note:** The app currently uses system Python and does not detect virtual environments. This option is only for standalone testing of the embedding server.

**Pros:**
- Isolated environment (no conflicts with other Python projects)
- Easy to uninstall (just delete `.venv` folder)

**Steps:**

1. **Create and activate virtual environment:**
   ```bash
   cd embedding_sidecar
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Test standalone:**
   ```bash
   python embed_server.py
   ```

## What Gets Installed

The dependencies include:

| Package | Size | Purpose |
|---------|------|---------|
| **torch** | ~328 MB | PyTorch machine learning framework |
| **transformers** | ~115 MB | HuggingFace transformers library |
| **sentence-transformers** | ~2 MB | Sentence embedding wrapper |
| **fastapi** | ~1 MB | Web framework for API server |
| **uvicorn** | ~1 MB | ASGI server |
| **pypdf** | ~3 MB | PDF text extraction |
| **pydantic** | ~4 MB | Data validation |

**Total download:** ~2.2 GB (including dependencies)

**Installation time:** 3-10 minutes depending on your internet connection

## First Run

On first run, the app will also download the embedding model:
- **Model:** paraphrase-multilingual-mpnet-base-v2
- **Size:** ~450 MB
- **Location:** `~/.cache/huggingface/`

This is a one-time download and will be cached for future use.

## Troubleshooting

### Python Not Found

**Error:** `python3: command not found`

**Solution:** Install Python:
- **macOS:** `brew install python@3.11` or download from [python.org](https://www.python.org/downloads/)
- **Linux:** `sudo apt-get install python3.11` (Ubuntu/Debian)

### Wrong Python Version

**Error:** `Python version incompatible (requires 3.9+)`

**Solution:**
```bash
# Check your Python version
python3 --version

# Install a newer version if needed
brew install python@3.11  # macOS
```

### Missing Dependencies

**Error:** `Required Python dependencies are not installed`

**Solution:** Follow the Quick Setup steps above to install dependencies.

### Installation Fails

**Common issues:**

1. **Insufficient disk space:**
   - Free up at least 2.5 GB
   - Check with: `df -h`

2. **Network issues:**
   - Retry installation
   - Use: `pip install --no-cache-dir -r requirements.txt`

3. **Permission denied:**
   - Try: `python3 -m pip install --user -r embedding_sidecar/requirements.txt`
   - Or with sudo (if needed): `sudo pip3 install -r embedding_sidecar/requirements.txt`

### Model Download Fails

**Error:** Model download fails on first run

**Solution:**
1. Check internet connection
2. Verify HuggingFace is accessible
3. Try manual download:
   ```bash
   python3 -c "from sentence_transformers import SentenceTransformer; model = SentenceTransformer('paraphrase-multilingual-mpnet-base-v2')"
   ```

## Uninstalling

To remove Python dependencies:

```bash
python3 -m pip uninstall -y fastapi uvicorn pydantic sentence-transformers torch pypdf
```

## Development Notes

### Using a Different Python Version

To use a specific Python version:

```bash
# Use Python 3.10 specifically
python3.10 -m pip install -r embedding_sidecar/requirements.txt
```

### Updating Dependencies

To update all dependencies to the latest versions:

```bash
python3 -m pip install --upgrade -r embedding_sidecar/requirements.txt
```

### Custom Model Cache Location

To use a different directory for model caching:

```bash
export HF_HOME=/path/to/custom/cache
npm run dev
```

## Verification

After installation, verify everything works:

1. **Check dependencies:**
   ```bash
   python3 embedding_sidecar/check_deps.py
   ```
   Expected output:
   ```json
   {
     "all_present": true,
     "python_version": "3.11.6",
     "deps": {
       "fastapi": true,
       "uvicorn": true,
       "pydantic": true,
       "sentence_transformers": true,
       "torch": true,
       "pypdf": true
     },
     "missing": []
   }
   ```

2. **Test the embedding server:**
   ```bash
   python3 embedding_sidecar/embed_server.py
   ```
   Should start server on `http://127.0.0.1:8421`

3. **Test embedding generation:**
   ```bash
   curl -X POST http://127.0.0.1:8421/embed \
     -H "Content-Type: application/json" \
     -d '{"texts": ["Hello world"]}'
   ```
   Should return a 768-dimensional vector.

## Additional Resources

- [Python Virtual Environments Guide](https://docs.python.org/3/tutorial/venv.html)
- [pip Documentation](https://pip.pypa.io/en/stable/)
- [HuggingFace Transformers](https://huggingface.co/docs/transformers/index)
- [Sentence Transformers](https://www.sbert.net/)

## Need Help?

If you encounter issues not covered here:
1. Check the logs: `~/Library/Logs/Semantica/`
2. File an issue on GitHub with:
   - Python version (`python3 --version`)
   - Operating system
   - Error message
   - Output of `check_deps.py`
