# Resources Directory

This directory contains bundled dependencies for zero-installation user experience.

## Structure

```
resources/
├── python/
│   ├── darwin-arm64/     # Python runtime + dependencies for Apple Silicon
│   │   └── venv/         # Virtual environment with PyTorch, transformers, etc.
│   └── darwin-x64/       # Python runtime + dependencies for Intel Mac
│       └── venv/
└── poppler/
    ├── darwin-arm64/     # Poppler utilities for Apple Silicon
    │   ├── pdftoppm      # PDF to image converter
    │   ├── pdfinfo       # PDF metadata extractor
    │   ├── lib/          # Bundled dylibs
    │   └── LICENSE       # GPL license
    └── darwin-x64/       # Poppler utilities for Intel Mac
        └── ...
```

## Building Resources

### Python Runtime

Run the bundling script:
```bash
./scripts/bundle-python.sh
```

This will:
1. Download Python 3.11 for your platform
2. Create virtual environment
3. Install dependencies from `embedding_sidecar/requirements.txt`
4. Optimize bundle (strip symbols, remove tests/docs)
5. Target size: <280MB per platform

### Poppler Utilities

Run the bundling script:
```bash
./scripts/bundle-poppler.sh
```

This will:
1. Copy pdftoppm and pdfinfo from Homebrew installation
2. Bundle required dylibs using dylibbundler
3. Add GPL license
4. Target size: ~5-10MB per platform

**Prerequisites:**
- Homebrew installation: `brew install poppler dylibbundler`

## Notes

- These directories are bundled with the app via electron-builder's `extraResources`
- Python includes CPU + MPS (Apple Silicon GPU) support
- Model weights (~450MB) are downloaded at runtime, NOT bundled
- See `/docs/specs/bundling-strategy.md` for complete documentation

## .gitignore

The contents of `python/*/venv/` and `poppler/*/` are gitignored (too large).
Only the bundling scripts and this README are committed.
