# Python Setup Guide

This guide explains how to set up Python and its dependencies for Semantica's embedding service.

## Prerequisites

Semantica requires:
- **Python 3.9 or later** (3.9, 3.10, or 3.11 recommended)
- **pip** (Python package installer)
- **2.2 GB free disk space** for dependencies

## Quick Setup (Recommended)

The recommended approach uses a virtual environment to keep dependencies isolated:

```bash
cd embedding_sidecar
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**That's it!** The app will automatically detect and use the virtual environment.

## Installation Methods

### Option A: Virtual Environment (Recommended)

**Pros:**
- Isolated environment (no conflicts with other Python projects)
- Easy to uninstall (just delete `.venv` folder)
- No system-wide changes
- Automatically detected by the app

**Steps:**

1. **Navigate to the embedding_sidecar directory:**
   ```bash
   cd embedding_sidecar
   ```

2. **Create virtual environment:**
   ```bash
   python3 -m venv .venv
   ```

3. **Activate virtual environment:**
   ```bash
   source .venv/bin/activate
   ```

4. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

5. **Verify installation:**
   ```bash
   python check_deps.py
   ```
   Should output: `{"all_present": true, ...}`

**To deactivate the virtual environment later:**
```bash
deactivate
```

### Option B: System-wide Installation (Not Recommended)

**Warning:** This installs packages globally and may conflict with other Python projects.

```bash
pip3 install -r embedding_sidecar/requirements.txt
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

### Virtual Environment Not Detected

If you created a virtual environment but the app isn't using it:

1. Verify the virtual environment exists:
   ```bash
   ls embedding_sidecar/.venv/bin/python
   ```

2. Restart the app to re-detect the environment

3. Check logs for "Using virtual environment" message

### Installation Fails

**Common issues:**

1. **Insufficient disk space:**
   - Free up at least 2.5 GB
   - Check with: `df -h`

2. **Network issues:**
   - Retry installation
   - Use: `pip install --no-cache-dir -r requirements.txt`

3. **Permission denied:**
   - Don't use `sudo` with virtual environments
   - For system-wide install: `sudo pip3 install -r requirements.txt` (not recommended)

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

### Virtual Environment (Clean)

Simply delete the virtual environment folder:
```bash
rm -rf embedding_sidecar/.venv
```

### System-wide Installation

```bash
pip3 uninstall fastapi uvicorn sentence-transformers torch pypdf pydantic
```

## Development Notes

### Using a Different Python Version

To use a specific Python version with venv:

```bash
# Use Python 3.10 specifically
python3.10 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Updating Dependencies

To update all dependencies to the latest versions:

```bash
source .venv/bin/activate
pip install --upgrade -r requirements.txt
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
   cd embedding_sidecar
   source .venv/bin/activate
   python embed_server.py
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
