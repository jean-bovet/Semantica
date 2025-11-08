# Resources Directory

This directory contains bundled dependencies for zero-installation user experience.

## Structure

```
resources/
└── python/
    ├── darwin-arm64/     # Python runtime + dependencies for Apple Silicon
    │   └── venv/         # Virtual environment with PyTorch, transformers, etc.
    └── darwin-x64/       # Python runtime + dependencies for Intel Mac
        └── venv/
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
5. Target size: ~640MB per platform

## Notes

- This directory is bundled with the app via electron-builder's `extraResources`
- Python includes CPU + MPS (Apple Silicon GPU) support
- Model weights (~450MB) are downloaded at runtime, NOT bundled
- See `/docs/guides/bundling-guide.md` for complete documentation

## .gitignore

The contents of `python/*/venv/` are gitignored (too large).
Only the bundling script and this README are committed.
