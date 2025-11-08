# Bundling Guide: Python Runtime

This guide explains how to bundle the Python runtime with Semantica.

**Status:** REQUIRED for all builds (development and production)
**Implementation:** Complete (v1.0.4+)

---

## Overview

Semantica **requires** a bundled Python runtime. The app will throw clear error messages if the bundle is missing.

**What gets bundled:**
- Python 3.11 runtime (~50MB)
- Python dependencies: PyTorch, transformers, sentence-transformers, etc. (~590MB)
- **Total bundle size:** ~640MB

**What's NOT bundled:**
- Model weights (~450MB) - downloaded on first run from HuggingFace
- Poppler (no longer needed - OCR is Node.js native as of v1.0.4!)

**Why required bundling?**
- ✅ 100% consistency between development and production
- ✅ Catch bundling issues immediately (no silent fallbacks)
- ✅ Professional zero-setup user experience
- ✅ GPU acceleration (MPS) preserved
- ✅ No "works on my machine" issues
- ✅ Simpler dependencies (no Poppler, no dylibbundler)

---

## Prerequisites

Before bundling, ensure you have:

1. **Python 3.9+** (preferably 3.11)
   ```bash
   python3 --version
   # Should output: Python 3.11.x or 3.9+
   ```

2. **Disk space:** ~3GB free (for building bundle and temporary files)

---

## Quick Start

**For new developers or after updating dependencies:**

```bash
# Bundle Python dependencies (5-10 minutes)
npm run bundle
```

**Then run the app normally:**
```bash
npm run dev  # Automatic bundle check runs first
```

**If bundle is missing**, you'll see a clear error message:
```
❌ Bundled Python not found
   Expected: resources/python/darwin-arm64/venv/bin/python3
   Run: ./scripts/bundle-python.sh
```

---

## Detailed Steps

### Step 1: Bundle Python Runtime

This creates a self-contained Python environment with all dependencies.

```bash
./scripts/bundle-python.sh
```

**What it does:**
1. Detects your platform (Apple Silicon or Intel)
2. Creates a virtual environment in `resources/python/{platform}/venv/`
3. Installs all dependencies from `embedding_sidecar/requirements.txt`
4. Optimizes the bundle (strips symbols, removes tests/docs)
5. Verifies PyTorch, transformers, and MPS support

**Expected output:**
```
=== Semantica Python Bundler ===
Platform detected: darwin-arm64
Found Python: python3.11 (3.11.x)
Creating virtual environment...
Installing dependencies from requirements.txt...
This will take 3-10 minutes and download ~2.2GB...
[... installation progress ...]
Dependencies installed successfully
Running optimization script...
[... optimization progress ...]
Verifying installation...
PyTorch: 2.5.1
Transformers: x.x.x
Sentence Transformers: x.x.x
Checking device support...
MPS available: True
✓ Apple Silicon GPU (MPS) support enabled
Bundle created successfully!
Location: /Users/.../resources/python/darwin-arm64/venv
Size: ~640MB
```

**Time:** 3-10 minutes (depends on internet speed)

**Troubleshooting:**
- If Python 3.9+ not found: Install from https://www.python.org/downloads/
- If pip install fails: Check internet connection, try again
- If MPS not available: You're on Intel Mac (CPU mode is normal)

---

## Step 2: Verify Bundle Structure

Check that the bundle was created correctly:

```bash
# Check Python bundle
ls -lh resources/python/darwin-*/venv/bin/python3
du -sh resources/python/

# Total bundle size
du -sh resources/
# Should show: ~640MB
```

Expected structure:
```
resources/
├── README.md
└── python/
    └── darwin-arm64/          # or darwin-x64
        └── venv/
            ├── bin/python3
            └── lib/python3.11/site-packages/
                ├── torch/
                ├── transformers/
                ├── sentence_transformers/
                └── ...
```

**Note:** Poppler is no longer bundled - OCR is handled natively in Node.js (v1.0.4+)

---

## Step 3: Build Packaged App

Now build the app with bundled dependencies:

```bash
npm run build
npm run package
```

Or for signed/notarized builds:

```bash
npm run dist
```

**What happens:**
- `electron-builder` includes bundle via `extraResources` config
- Python is copied to `Contents/Resources/python/` in app bundle
- Python binaries are code-signed automatically
- App bundle size: ~850MB (vs ~220MB without bundling)

**Build time:** 5-10 minutes (longer if notarizing)

---

## Step 4: Test Packaged App

Test on a **clean Mac** (without system Python):

### Manual Testing

1. Install the packaged app (drag to Applications)
2. Launch Semantica
3. Check console/logs for bundled Python detection:
   ```
   Using bundled Python: /Applications/Semantica.app/Contents/Resources/python/venv/bin/python3
   ```
4. Verify model download works (first run)
5. Add a folder for indexing
6. Test OCR with a scanned PDF (Node.js native OCR - no Poppler needed!)
7. Test search functionality

### Automated Testing

```bash
# Unit tests (should pass)
npm run test:unit

# Integration tests (should pass with bundled Python)
npm run test:integration

# E2E tests (should pass)
npm run test:e2e
```

---

## Step 5: Distribution

Once verified, distribute the packaged app:

### DMG Distribution
The DMG file is in `dist-app/`:
```bash
ls -lh dist-app/*.dmg
# Semantica-1.0.4-arm64.dmg (~850MB)
```

Upload to:
- GitHub Releases
- Website download page
- Mac App Store (requires additional review)

### Release Notes

Include in release notes:
```markdown
## What's New in v1.0.4

### Zero-Installation Setup
- No manual Python installation required
- OCR now runs natively in Node.js - no Poppler needed!
- Just download, install, and use!

### OCR Improvements
- 3-10x faster OCR (~76-266ms per page vs ~2-3s per 10 pages)
- Node.js native implementation - no external dependencies
- Same accuracy using macOS Vision framework

### Technical Details
- Python 3.11 runtime bundled with app
- GPU acceleration (Apple Silicon) included
- Model weights (~450MB) downloaded on first launch
- App size: 850MB (includes all dependencies except model)

### Breaking Changes
- Existing users: App bundle is larger (640MB Python bundle)
- First launch: Model download required (~450MB, 2-5 minutes)
```

---

## Maintenance

### Updating Python Dependencies

When updating `embedding_sidecar/requirements.txt`:

1. Clean old bundle:
   ```bash
   rm -rf resources/python/
   ```

2. Re-run bundling:
   ```bash
   ./scripts/bundle-python.sh
   ```

3. Test thoroughly before release

### Security Updates

Monitor for security vulnerabilities:
- PyTorch: https://pytorch.org/blog/
- Transformers: https://github.com/huggingface/transformers/security

When critical updates are available:
1. Update `requirements.txt`
2. Re-bundle
3. Release patch version

---

## Troubleshooting

### Bundle Scripts Fail

**Python bundle fails during pip install:**
- Check internet connection
- Try again (network timeout)
- Check Python version: `python3 --version`

### Packaged App Issues

**"Python not found" in production:**
- Check bundle was created: `ls resources/python/darwin-*/venv/bin/python3`
- Verify `extraResources` in package.json is correct
- Check build logs for bundling errors

**OCR not working in packaged app:**
- OCR is now Node.js native - no external dependencies needed
- Check app logs for errors in `/src/main/ocr/` modules
- Verify macOS version is 12+ (required for Vision framework)

**MPS (GPU) not working:**
- This is normal on Intel Macs (CPU-only)
- On Apple Silicon, check PyTorch version: should be 2.5.1+
- Verify MPS is available: Run Python script to check `torch.backends.mps.is_available()`

---

## Platform-Specific Notes

### Apple Silicon (M1/M2/M3)
- Platform: `darwin-arm64`
- MPS support: ✅ Included
- Python bundle size: ~640MB

### Intel Mac (x86_64)
- Platform: `darwin-x64`
- MPS support: ❌ CPU only
- Python bundle size: ~640MB (same)

### Universal Binary
Not recommended - would double bundle size to ~1.3GB.
Better to provide separate builds for each platform.

---

## Rollback to Manual Installation

If bundling causes issues, you can revert:

1. **Remove bundled dependencies:**
   ```bash
   rm -rf resources/python/
   ```

2. **Remove from package.json:**
   Delete the `extraResources` config

3. **Revert PythonSidecarService.ts:**
   ```bash
   git checkout src/main/worker/PythonSidecarService.ts
   ```

4. **Update documentation:**
   Restore manual installation instructions

5. **Rebuild:**
   ```bash
   npm run package
   ```

App will work as before with manual Python installation.
Note: OCR will still work (Node.js native) - no Poppler needed!

---

## Resources

- **Full strategy:** `/docs/specs/bundling-strategy.md`
- **Python sidecar spec:** `/docs/specs/python-sidecar.md`
- **Node.js OCR implementation:** `/src/main/ocr/`
- **Scripts:**
  - `/scripts/bundle-python.sh`
  - `/scripts/optimize-python-bundle.sh`
  - `/scripts/check-bundles.sh`

---

## FAQ

**Q: Why is the app so large?**
A: 850MB is comparable to VS Code (300-500MB) and smaller than Docker Desktop (600MB-1GB). The size includes a full Python ML stack with PyTorch (~640MB).

**Q: Can I reduce the bundle size?**
A: The optimization script already removes ~50-100MB. Further reduction would require removing functionality.

**Q: What about model weights?**
A: Model weights (450MB) are downloaded separately on first run and cached locally. This allows model updates without app updates.

**Q: Does bundling affect performance?**
A: No. Performance is identical to manual installation. MPS (GPU) support is preserved.

**Q: Is Poppler still needed for OCR?**
A: No! As of v1.0.4, OCR is handled natively in Node.js using macOS Vision framework. No external dependencies required!

**Q: What about Linux/Windows?**
A: This guide is macOS-only. Linux/Windows bundling would follow a similar approach but with platform-specific tools.

---

**End of Guide**
