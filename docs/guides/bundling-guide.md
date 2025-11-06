# Bundling Guide: Python + Poppler

This guide explains how to bundle Python runtime and Poppler utilities with Semantica.

**Status:** REQUIRED for all builds (development and production)
**Implementation:** Complete

---

## Overview

Semantica **requires** bundled Python and Poppler dependencies. The app will throw clear error messages if bundles are missing.

**What gets bundled:**
- Python 3.11 runtime (~50MB)
- Python dependencies: PyTorch, transformers, etc. (~230MB)
- Poppler utilities for OCR (~5-10MB)
- **Total bundle increase:** ~290-300MB

**What's NOT bundled:**
- Model weights (~450MB) - downloaded on first run from HuggingFace

**Why required bundling?**
- ✅ 100% consistency between development and production
- ✅ Catch bundling issues immediately (no silent fallbacks)
- ✅ Professional zero-setup user experience
- ✅ OCR works out-of-box
- ✅ GPU acceleration (MPS) preserved
- ✅ No "works on my machine" issues

---

## Prerequisites

Before bundling, ensure you have:

1. **Python 3.9+** (preferably 3.11)
   ```bash
   python3 --version
   # Should output: Python 3.11.x or 3.9+
   ```

2. **Homebrew** (macOS package manager)
   ```bash
   brew --version
   ```

3. **Poppler** (for OCR support)
   ```bash
   brew install poppler
   ```

4. **dylibbundler** (for Poppler dependency bundling)
   ```bash
   brew install dylibbundler
   ```

5. **Disk space:** ~3GB free (for building bundles)

---

## Quick Start

**For new developers or after updating dependencies:**

```bash
# One command to bundle everything (recommended)
npm run bundle

# Or run scripts individually:
./scripts/bundle-python.sh    # 5-10 minutes
./scripts/bundle-poppler.sh   # <1 minute
```

**Then run the app normally:**
```bash
npm run dev  # Automatic bundle check runs first
```

**If bundles are missing**, you'll see a clear error message:
```
❌ Bundled Python not found
   Run: ./scripts/bundle-python.sh

❌ Bundled Poppler not found
   Run: ./scripts/bundle-poppler.sh
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
Size: ~280MB
```

**Time:** 3-10 minutes (depends on internet speed)

**Troubleshooting:**
- If Python 3.9+ not found: Install from https://www.python.org/downloads/
- If pip install fails: Check internet connection, try again
- If MPS not available: You're on Intel Mac (CPU mode is normal)

---

## Step 2: Bundle Poppler Utilities

This bundles PDF utilities needed for OCR.

```bash
./scripts/bundle-poppler.sh
```

**What it does:**
1. Detects your platform (Apple Silicon or Intel)
2. Copies `pdftoppm` and `pdfinfo` from Homebrew installation
3. Bundles required dylibs using `dylibbundler`
4. Adds GPL license file
5. Tests bundled binaries

**Expected output:**
```
=== Semantica Poppler Bundler ===
Platform detected: darwin-arm64
Homebrew prefix: /opt/homebrew
Found required binaries:
  pdftoppm: /opt/homebrew/opt/poppler/bin/pdftoppm
  pdfinfo: /opt/homebrew/opt/poppler/bin/pdfinfo
Copying binaries...
Bundling dependencies with dylibbundler...
[... bundling progress ...]
Dependencies bundled successfully
Testing bundled binaries...
  ✓ pdftoppm works: pdftoppm version x.x.x
  ✓ pdfinfo works: pdfinfo version x.x.x
Bundle created successfully!
Location: /Users/.../resources/poppler/darwin-arm64
Size: ~8MB
Libraries bundled: 15
```

**Time:** <1 minute

**Troubleshooting:**
- If Poppler not found: `brew install poppler`
- If dylibbundler not found: `brew install dylibbundler`
- If bundled binary fails: Check Homebrew installation integrity

---

## Step 3: Verify Bundle Structure

Check that bundles were created correctly:

```bash
# Check Python bundle
ls -lh resources/python/darwin-*/venv/bin/python3
du -sh resources/python/

# Check Poppler bundle
ls -lh resources/poppler/darwin-*/pdftoppm
du -sh resources/poppler/

# Total bundle size
du -sh resources/
# Should show: ~290-300MB
```

Expected structure:
```
resources/
├── README.md
├── python/
│   └── darwin-arm64/          # or darwin-x64
│       └── venv/
│           ├── bin/python3
│           └── lib/python3.11/site-packages/
│               ├── torch/
│               ├── transformers/
│               └── ...
└── poppler/
    └── darwin-arm64/          # or darwin-x64
        ├── pdftoppm
        ├── pdfinfo
        ├── lib/               # Bundled dylibs
        └── LICENSE            # GPL license
```

---

## Step 4: Build Packaged App

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
- `electron-builder` includes bundles via `extraResources` config
- Python and Poppler are copied to `Contents/Resources/` in app bundle
- Poppler binaries are code-signed automatically
- App bundle size: ~510-520MB (vs ~220MB without bundling)

**Build time:** 5-10 minutes (longer if notarizing)

---

## Step 5: Test Packaged App

Test on a **clean Mac** (without Homebrew Python/Poppler):

### Manual Testing

1. Install the packaged app (drag to Applications)
2. Launch Semantica
3. Check console/logs for bundled Python detection:
   ```
   Using bundled Python: /Applications/Semantica.app/Contents/Resources/python/venv/bin/python3
   Adding bundled Poppler to PATH: /Applications/Semantica.app/Contents/Resources/poppler
   ```
4. Verify model download works (first run)
5. Add a folder for indexing
6. Test OCR with a scanned PDF
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

## Step 6: Distribution

Once verified, distribute the packaged app:

### DMG Distribution
The DMG file is in `dist-app/`:
```bash
ls -lh dist-app/*.dmg
# Semantica-1.0.4-arm64.dmg (~510MB)
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
- OCR support works out-of-box (no Homebrew needed)
- Just download, install, and use!

### Technical Details
- Python 3.11 runtime bundled with app
- GPU acceleration (Apple Silicon) included
- Model weights (~450MB) downloaded on first launch
- App size: 510MB (includes all dependencies except model)

### Breaking Changes
- Existing users: App bundle is now larger (300MB increase)
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

### Updating Poppler

When Poppler updates in Homebrew:

1. Update Homebrew:
   ```bash
   brew upgrade poppler
   ```

2. Clean old bundle:
   ```bash
   rm -rf resources/poppler/
   ```

3. Re-run bundling:
   ```bash
   ./scripts/bundle-poppler.sh
   ```

### Security Updates

Monitor for security vulnerabilities:
- PyTorch: https://pytorch.org/blog/
- Transformers: https://github.com/huggingface/transformers/security
- Poppler: https://poppler.freedesktop.org/

When critical updates are available:
1. Update `requirements.txt` or Homebrew packages
2. Re-bundle
3. Release patch version

---

## Troubleshooting

### Bundle Scripts Fail

**Python bundle fails during pip install:**
- Check internet connection
- Try again (network timeout)
- Check Python version: `python3 --version`

**Poppler bundle fails:**
- Verify Poppler installed: `brew list poppler`
- Verify dylibbundler installed: `brew list dylibbundler`
- Check Homebrew prefix matches script: `echo $HOMEBREW_PREFIX`

### Packaged App Issues

**"Python not found" in production:**
- Check bundle was created: `ls resources/python/darwin-*/venv/bin/python3`
- Verify `extraResources` in package.json is correct
- Check build logs for bundling errors

**OCR not working in packaged app:**
- Check Poppler bundle exists: `ls resources/poppler/darwin-*/pdftoppm`
- Verify DYLD_LIBRARY_PATH is set (check logs)
- Test bundled binary manually

**MPS (GPU) not working:**
- This is normal on Intel Macs (CPU-only)
- On Apple Silicon, check PyTorch version: should be 2.5.1+
- Verify MPS is available: Run Python script to check `torch.backends.mps.is_available()`

---

## Platform-Specific Notes

### Apple Silicon (M1/M2/M3)
- Platform: `darwin-arm64`
- MPS support: ✅ Included
- Homebrew prefix: `/opt/homebrew`
- Bundle size: ~290MB

### Intel Mac (x86_64)
- Platform: `darwin-x64`
- MPS support: ❌ CPU only
- Homebrew prefix: `/usr/local`
- Bundle size: ~290MB (same)

### Universal Binary
Not recommended - would double bundle size to ~560MB.
Better to provide separate builds for each platform.

---

## Rollback to Manual Installation

If bundling causes issues, you can revert:

1. **Remove bundled dependencies:**
   ```bash
   rm -rf resources/python/
   rm -rf resources/poppler/
   ```

2. **Remove from package.json:**
   Delete the `extraResources` and `mac.binaries` config

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

App will work as before with manual Python/Poppler installation.

---

## Resources

- **Full strategy:** `/docs/specs/bundling-strategy.md`
- **Python sidecar spec:** `/docs/specs/python-sidecar.md`
- **Scripts:**
  - `/scripts/bundle-python.sh`
  - `/scripts/bundle-poppler.sh`
  - `/scripts/optimize-python-bundle.sh`

---

## FAQ

**Q: Why is the app so large?**
A: 510MB is comparable to VS Code (300-500MB) and smaller than Docker Desktop (600MB-1GB). The size includes a full Python ML stack with PyTorch.

**Q: Can I reduce the bundle size?**
A: The optimization script already removes ~100-200MB. Further reduction would require removing functionality.

**Q: What about model weights?**
A: Model weights (450MB) are downloaded separately on first run and cached locally. This allows model updates without app updates.

**Q: Does bundling affect performance?**
A: No. Performance is identical to manual installation. MPS (GPU) support is preserved.

**Q: Can users still use system Python?**
A: In development mode, yes. In production, the bundled Python is preferred but falls back to system Python if not found.

**Q: What about Linux/Windows?**
A: This guide is macOS-only. Linux/Windows bundling would follow a similar approach but with platform-specific tools.

---

**End of Guide**
