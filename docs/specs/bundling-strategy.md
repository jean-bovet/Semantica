# Bundling Strategy: Python Runtime + Poppler Utilities

**Status:** Planning (Phase 3 of Python Sidecar Implementation - Deferred)
**Last Updated:** 2025-11-04
**Decision:** To Be Determined

---

## Executive Summary

This document outlines the strategy for bundling Python runtime and Poppler utilities with Semantica to achieve zero-installation user experience.

### Bundle Size Impact

| Component | Size | Strategy |
|-----------|------|----------|
| Python 3.11 runtime | ~50MB | Bundle with app |
| Python dependencies (PyTorch, transformers, etc.) | ~230MB | Bundle with app |
| Poppler utilities (pdftoppm, pdfinfo, libpoppler) | ~5-10MB | Bundle with app |
| **Total Bundle Increase** | **~290-300MB** | |
| Model weights (paraphrase-multilingual-mpnet-base-v2) | 0MB | **Download at runtime** |
| Poppler full dependencies | 0MB | Included in minimal bundle |

**Current App Size:** ~220MB (Electron + Chromium + Node.js)
**New App Size:** ~510-520MB total

### Implementation Effort

- **Time Estimate:** 2-3 days
- **Complexity:** Moderate
- **Risk:** Low (can fall back to manual installation)

### Key Benefits

✅ **Zero technical setup** - download and use immediately
✅ **Professional UX** - comparable to VS Code, Slack, etc.
✅ **Consistent environment** - no "works on my machine" issues
✅ **OCR works out-of-box** - no manual Poppler installation
✅ **GPU acceleration preserved** - MPS (Apple Silicon) support included
✅ **Still mostly offline** - only model download on first run (~450MB, 2-5 min)

### Key Trade-offs

❌ **+300MB bundle size** (but reasonable for desktop productivity apps)
❌ **Platform-specific builds** (Intel vs Apple Silicon)
❌ **Update coupling** (Python/Poppler updates require app update)
❌ **Code signing complexity** (all binaries must be signed and notarized)

---

## Important: GPU Acceleration is Preserved

### Semantica Already Uses Apple Silicon GPU

**Current implementation** (`embedding_sidecar/embed_server.py:74-84`):
```python
def pick_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"  # Apple Silicon GPU (Metal Performance Shaders)
    if torch.cuda.is_available():
        return "cuda"  # NVIDIA GPU
    return "cpu"
```

**Semantica is ALREADY using MPS** (Metal Performance Shaders) for GPU acceleration on Apple Silicon Macs!
- Device priority: MPS > CUDA > CPU
- Performance: 55-93 texts/sec with MPS
- Confirmed working in production tests (October 2025)

### Bundling Does NOT Lose GPU Support

**Critical clarification:** On macOS, there is **NO separate "CPU-only" PyTorch build**.

- **Linux/Windows:** Can install `torch+cpu` (excludes CUDA, saves ~100MB)
- **macOS:** Standard PyTorch includes both CPU and MPS support (no CUDA anyway)

**What gets bundled:**
- PyTorch 2.5.1 standard macOS wheel
- ✅ Includes CPU support
- ✅ Includes MPS support (Apple Silicon GPU)
- ❌ No CUDA (doesn't exist on Mac)

**Performance is identical:**
- Current (manual install): 55-93 texts/sec using MPS
- After bundling: 55-93 texts/sec using MPS (no change)

**Device auto-detection continues to work** - bundled PyTorch will automatically use Apple Silicon GPU when available, falling back to CPU on Intel Macs or if MPS is unavailable.

---

## Part 1: Python Bundling

### 1.1 Current State (Manual Installation)

**User must install:**
```bash
# Install Python dependencies (2.2GB download, 3-10 min)
pip install -r embedding_sidecar/requirements.txt

# First run: Model auto-downloads (~450MB, 2-5 min)
# Stored at: ~/.cache/huggingface/hub/
```

**Pain points:**
- Requires technical knowledge
- 5-15 minutes of setup time
- Support burden ("pip not found", version conflicts)
- Poor first impression

### 1.2 What Gets Bundled

#### A. Python Runtime (~50MB)

**Source:** Python.org official build for Python 3.11
**Platforms:** macOS (Intel + Apple Silicon)
**Bundle location:** `resources/python/bin/python3`

**Alternative (not recommended):** Miniforge/Miniconda (~150MB, includes conda)

#### B. Python Dependencies (~230MB)

From `embedding_sidecar/requirements.txt`:

| Package | Version | Size | Purpose |
|---------|---------|------|---------|
| **torch** | 2.5.1 | ~150-200MB | PyTorch ML framework (includes CPU + MPS for Apple Silicon GPU) |
| **transformers** | (dependency) | ~115MB | HuggingFace transformers library |
| **sentence-transformers** | 3.2.1 | ~2MB | Embedding model wrapper |
| **fastapi** | 0.115.5 | ~1MB | Web framework for HTTP API |
| **uvicorn** | 0.32.0 | ~1MB | ASGI server |
| **pydantic** | 2.9.2 | ~4MB | Data validation |
| **pypdf** | 5.0.1 | ~3MB | PDF text extraction |
| **pymupdf** | 1.24.14 | ~10MB | PDF rendering for OCR |
| **pdf2image** | 1.17.0 | <1MB | PDF to image conversion (requires Poppler) |
| **ocrmac** | 1.0.0 | <1MB | macOS Vision framework bindings |

**Total:** ~230MB (after optimization)

#### C. What's NOT Bundled

❌ **Model weights** (~450MB)
- Downloaded from HuggingFace on first run
- Cached at `~/.cache/huggingface/hub/`
- Subsequent runs use cached model
- Allows model updates independent of app updates

❌ **Poppler utilities** (see Part 2 - bundled separately)

### 1.3 Size Optimization Strategies

#### 1. PyTorch Standard Build (macOS - No Optimization Needed)

**Important:** Unlike Linux/Windows, macOS PyTorch does NOT have a separate "CPU-only" build.

The standard macOS PyTorch wheel (`torch==2.5.1`) already:
- ✅ Includes CPU support
- ✅ Includes MPS support (Apple Silicon GPU)
- ❌ Excludes CUDA (doesn't exist on Mac)
- Size: ~150-200MB (already optimized for macOS)

**No action needed** - install PyTorch normally:
```bash
pip install torch==2.5.1
```

**Note for other platforms:**
- Linux/Windows can use `--index-url https://download.pytorch.org/whl/cpu` to save ~100MB
- This excludes CUDA support
- Not applicable to macOS

#### 2. Strip Debug Symbols
```bash
find site-packages -name "*.so" -exec strip {} \;
```
- **Savings:** ~50-100MB
- **Trade-off:** Harder to debug native library crashes

#### 3. Remove Unnecessary Files
```bash
# Remove test suites
find site-packages -type d -name "tests" -exec rm -rf {} \;
find site-packages -type d -name "test" -exec rm -rf {} \;

# Remove documentation
find site-packages -type d -name "docs" -exec rm -rf {} \;

# Remove examples
find site-packages -type d -name "examples" -exec rm -rf {} \;
```
- **Savings:** ~30-50MB
- **Trade-off:** None (not used in production)

#### 4. Remove Unused PyTorch Backends (Not Applicable to macOS)

**Note:** This optimization is for Linux/Windows builds only.

On macOS:
- PyTorch doesn't include CUDA or ROCm (NVIDIA/AMD specific)
- No `*cuda*` or `*hip*` files to remove
- MPS support is integrated and cannot be separated
- **No action needed** for macOS builds

For reference on other platforms:
```bash
# Linux/Windows only - remove CUDA/ROCm
rm -rf site-packages/torch/lib/*cuda*
rm -rf site-packages/torch/lib/*hip*
```
- **Savings:** ~50MB (Linux/Windows only)
- **Trade-off:** None

**Target after optimization:** <280MB total

### 1.4 Technical Implementation

#### electron-builder Configuration

Update `package.json`:

```json
{
  "build": {
    "extraResources": [
      {
        "from": "resources/python",
        "to": "python",
        "filter": ["**/*"]
      },
      {
        "from": "embedding_sidecar",
        "to": "embedding_sidecar",
        "filter": ["**/*", "!.venv/**", "!__pycache__/**"]
      }
    ],
    "asarUnpack": [
      "**/*.node",
      "embedding_sidecar/**"
    ]
  }
}
```

**Note:** `embedding_sidecar/**` is already unpacked via `asarUnpack` (package.json:156)

#### Path Resolution

Update `src/main/worker/PythonSidecarService.ts`:

```typescript
private getDefaultPythonPath(): string {
  if (app.isPackaged) {
    // Production: use bundled Python
    return path.join(process.resourcesPath, 'python', 'bin', 'python3');
  } else {
    // Development: use system Python
    return 'python3';
  }
}
```

**Current implementation:**
- `getProjectRoot()` already handles packaged apps (lines 420-438)
- `getDefaultPythonPath()` returns `'python3'` (lines 446-448)
- `getPythonEnv()` provides comprehensive PATH for system Python (lines 457-476)

**Changes needed:**
- Modify `getDefaultPythonPath()` to return bundled Python path in production
- Ensure `getPythonEnv()` includes bundled Python in PATH for subprocess calls
- Add fallback to system Python if bundled Python fails

#### Dependency Installation Strategy

**Option A: Pre-install in Bundle (Recommended)**

Build process:
```bash
# Create virtual environment
python3 -m venv resources/python/venv

# Install dependencies
resources/python/venv/bin/pip install -r embedding_sidecar/requirements.txt

# Optimize (strip, remove tests/docs)
./scripts/optimize-python-bundle.sh

# Package with electron-builder
npm run package
```

**Pros:**
- Fast startup, no network required (except model download)
- Guaranteed working environment
- Professional UX

**Cons:**
- Larger bundle size (~280MB)
- More complex build process

**Option B: Install on First Run (Not Recommended)**

- Bundle Python runtime only (~50MB)
- Download and install dependencies on first launch
- **Cons:** Slower first run, requires network, adds complexity

### 1.5 Platform Considerations

#### macOS (Primary Target)

**Apple Silicon (ARM64):**
- Use native ARM64 Python build
- Ensure PyTorch is ARM64 native (not Rosetta)
- Test on M1/M2/M3 Macs

**Intel (x86_64):**
- Use x86_64 Python build
- Smaller user base, but still supported

**Universal Binary Approach:**
- Could create universal binary with both architectures
- Would double bundle size (~560MB)
- **Recommendation:** Separate builds for Intel and ARM

#### Code Signing & Notarization

**Requirements:**
- All Python binaries must be code signed
- All native extensions (.so files) must be signed
- Entire bundle must be notarized for Gatekeeper

**electron-builder handles:**
- Automatic code signing of bundled binaries
- Notarization submission to Apple
- Entitlements configuration

**Potential issues:**
- Large bundles take longer to notarize (~10-30 min)
- Some native libraries may have signing issues
- May need specific entitlements for Python runtime

---

## Part 2: Poppler Bundling

### 2.1 What is Poppler?

**Poppler** is a PDF rendering library providing command-line utilities for PDF manipulation.

**Purpose in Semantica:**
- Required for OCR feature (processing scanned PDFs)
- `pdf2image` Python library wraps Poppler's `pdftoppm` utility
- Converts PDF pages to images for macOS Vision OCR processing

**Code location:** `embedding_sidecar/embed_server.py:352-372`

### 2.2 Current State

**Manual installation:**
```bash
brew install poppler
```

**What gets installed:**
- `pdftoppm` utility (91KB) - converts PDF to images
- `pdfinfo` utility (105KB) - extracts PDF metadata
- `libpoppler.154.dylib` (3.2MB) - main library
- Plus 47 dependency libraries (~27MB)
- **Total:** 31MB from Homebrew

**User experience problems:**
- OCR silently fails without Poppler
- Error: "Unable to get page count" (pdf2image)
- Another manual installation step
- More support burden

### 2.3 What Gets Bundled

#### Minimal Bundle (Recommended)

**Binaries:**
- `pdftoppm` (91KB) - PDF to image conversion
- `pdfinfo` (105KB) - PDF metadata extraction

**Libraries:**
- `libpoppler.154.0.0.dylib` (3.2MB) - main library
- Supporting libraries (2-5MB) - from dependencies

**Total:** ~5-10MB

#### Full Bundle (Alternative)

- All Poppler utilities (~1.2MB)
- Complete dependency tree (~30MB)
- **Total:** ~31MB

**Recommendation:** Minimal bundle is sufficient for OCR needs

### 2.4 Dependency Analysis

#### Required Poppler Dependencies

`libpoppler.154.dylib` depends on:

**Image format libraries:**
- `freetype` - Font rendering
- `fontconfig` - Font configuration
- `jpeg-turbo` - JPEG support
- `openjpeg` - JPEG2000 support
- `libpng` - PNG support
- `libtiff` - TIFF support

**System libraries (already on macOS):**
- `libc++.1.dylib`
- `libSystem.B.dylib`
- `zlib.1.dylib`

**Optional (may exclude):**
- `nss`, `nspr` - SSL support (not needed for local files)
- `gpgme` - GPG signatures (not needed)
- `little-cms2` - Color management (optional)

**Strategy:**
- Bundle only essential image format libraries
- Use `dylibbundler` or `install_name_tool` to fix library paths
- Point to bundled libraries relative to binary

### 2.5 Technical Implementation

#### electron-builder Configuration

Update `package.json`:

```json
{
  "build": {
    "extraResources": [
      {
        "from": "resources/poppler/darwin-arm64",
        "to": "poppler",
        "filter": ["**/*"]
      }
    ],
    "mac": {
      "binaries": [
        "resources/poppler/darwin-arm64/pdftoppm",
        "resources/poppler/darwin-arm64/pdfinfo"
      ]
    }
  }
}
```

**Note:** `binaries` option ensures code signing

#### PATH Configuration

Update `src/main/worker/PythonSidecarService.ts`:

```typescript
private getPythonEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Add bundled Poppler to PATH
  if (app.isPackaged) {
    const popplerPath = path.join(process.resourcesPath, 'poppler');
    env.PATH = `${popplerPath}:${env.PATH}`;

    // Add library path for dylibs
    const popplerLibPath = path.join(popplerPath, 'lib');
    env.DYLD_LIBRARY_PATH = `${popplerLibPath}:${env.DYLD_LIBRARY_PATH || ''}`;
  }

  // ... existing Python PATH setup ...

  return env;
}
```

#### Build Script

Create `scripts/bundle-poppler.sh`:

```bash
#!/bin/bash
set -e

PLATFORM="darwin-arm64"  # or darwin-x64
POPPLER_DIR="resources/poppler/$PLATFORM"
HOMEBREW_POPPLER="/opt/homebrew/opt/poppler"

echo "Bundling Poppler utilities for $PLATFORM..."

# Create directories
mkdir -p "$POPPLER_DIR/lib"

# Copy binaries
cp "$HOMEBREW_POPPLER/bin/pdftoppm" "$POPPLER_DIR/"
cp "$HOMEBREW_POPPLER/bin/pdfinfo" "$POPPLER_DIR/"

# Copy main library
cp "$HOMEBREW_POPPLER/lib/libpoppler.154.0.0.dylib" "$POPPLER_DIR/lib/"
ln -s libpoppler.154.0.0.dylib "$POPPLER_DIR/lib/libpoppler.154.dylib"

# Copy dependencies using dylibbundler
dylibbundler -of -b \
  -x "$POPPLER_DIR/pdftoppm" \
  -x "$POPPLER_DIR/pdfinfo" \
  -d "$POPPLER_DIR/lib" \
  -p @executable_path/lib

echo "Poppler bundled successfully!"
echo "Size: $(du -sh $POPPLER_DIR | cut -f1)"
```

**Tools needed:**
- `dylibbundler` - copies and fixes library paths
- Install: `brew install dylibbundler`

#### Fallback Strategy

Implement graceful degradation in `embed_server.py`:

```python
# Check for Poppler availability
poppler_available = (
    shutil.which('pdftoppm') is not None and
    shutil.which('pdfinfo') is not None
)

if not poppler_available:
    logger.warning("Poppler not found. OCR will be unavailable.")
    # Disable OCR endpoint or return clear error
```

### 2.6 License Considerations

**Poppler License:** GPL v2 or GPL v3
**Semantica License:** MIT

**GPL Implications:**
- GPL requires software that **links** to GPL libraries to be GPL
- **Subprocess execution** (how pdf2image uses Poppler) does NOT trigger GPL obligations
- Bundling GPL binaries with MIT software is generally permitted if:
  - Binaries are separate executables (not linked)
  - GPL license is included with binaries
  - Source code availability is noted

**Required actions:**
1. Include Poppler's GPL license in `resources/poppler/LICENSE`
2. Add attribution to Semantica's about screen
3. Link to Poppler source code: https://poppler.freedesktop.org/

**Recommendation:** Consult legal counsel for final determination, but subprocess model should be compatible.

### 2.7 Cross-Platform Considerations

**Future: Linux support**
- Poppler is native to Linux (available via apt/dnf)
- May not need bundling on Linux
- Bundle anyway for consistency?

**Future: Windows support**
- Windows users don't have Homebrew
- Pre-built Windows binaries available
- Consider Zotero's cross-poppler project: https://github.com/zotero/cross-poppler

---

## Part 3: Implementation Plan

### Phase 1: Python Runtime Setup (Day 1)

**Goal:** Create optimized Python bundle ready for packaging

#### Tasks:

1. **Download Python 3.11** (~1 hour)
   - Get macOS ARM64 and x86_64 installers from Python.org
   - Extract to `resources/python/darwin-arm64/` and `resources/python/darwin-x64/`

2. **Create virtual environment** (~30 min)
   ```bash
   cd resources/python/darwin-arm64
   ./bin/python3 -m venv venv
   ```

3. **Install dependencies** (~1 hour)
   ```bash
   venv/bin/pip install -r ../../../embedding_sidecar/requirements.txt
   ```

4. **Optimize bundle** (~2 hours)
   - Strip debug symbols from .so files
   - Remove tests, docs, examples directories
   - Remove unused PyTorch backends
   - Target: <280MB

5. **Create build script** (~1 hour)
   - Automate steps 2-4
   - Script: `scripts/bundle-python.sh`
   - Platform detection (ARM64 vs x64)

6. **Test locally** (~1 hour)
   - Verify bundled Python works: `./venv/bin/python3 --version`
   - Test import: `./venv/bin/python3 -c "import torch; import transformers"`
   - Run check_deps.py with bundled Python

**Deliverable:** Optimized Python bundle in `resources/python/`

### Phase 2: Poppler Bundling (Day 2, Morning)

**Goal:** Bundle Poppler utilities with dependencies

#### Tasks:

1. **Install dylibbundler** (~5 min)
   ```bash
   brew install dylibbundler
   ```

2. **Create bundling script** (~1 hour)
   - Script: `scripts/bundle-poppler.sh`
   - Copy pdftoppm, pdfinfo binaries
   - Copy libpoppler and dependencies
   - Fix library paths with dylibbundler

3. **Test bundled Poppler** (~30 min)
   - Run `./pdftoppm -v` with bundled binary
   - Set DYLD_LIBRARY_PATH to bundled libs
   - Verify pdf2image can find utilities

4. **Add GPL license** (~15 min)
   - Copy Poppler's GPL license to `resources/poppler/LICENSE`
   - Add attribution to about screen

**Deliverable:** Poppler bundle in `resources/poppler/`

### Phase 3: electron-builder Integration (Day 2, Afternoon)

**Goal:** Configure app to use bundled Python and Poppler

#### Tasks:

1. **Update package.json** (~30 min)
   - Add `extraResources` for Python and Poppler
   - Add `binaries` for code signing
   - Configure platform-specific builds

2. **Modify PythonSidecarService** (~2 hours)
   - Update `getDefaultPythonPath()` for bundled Python
   - Update `getPythonEnv()` to add Poppler to PATH
   - Set DYLD_LIBRARY_PATH for Poppler libs
   - Add fallback to system Python/Poppler

3. **Build production app** (~1 hour)
   ```bash
   npm run package
   ```
   - Check bundle size
   - Verify Python and Poppler are included

4. **Test on clean Mac** (~2 hours)
   - Use Mac without Homebrew Python or Poppler
   - Install app
   - Verify embedding service starts
   - Test OCR functionality
   - Check model download works

**Deliverable:** Production build with bundled dependencies

### Phase 4: Testing & Polish (Day 3)

**Goal:** Ensure everything works correctly and efficiently

#### Tasks:

1. **Bundle size optimization** (~2 hours)
   - Analyze bundle contents
   - Remove any unnecessary files
   - Target: <300MB addition
   - Use: `du -sh` and `npx asar list`

2. **Code signing & notarization** (~2 hours)
   - Test signing all Python and Poppler binaries
   - Submit for notarization
   - Test on another Mac after notarization
   - Debug any entitlement issues

3. **Platform testing** (~2 hours)
   - Test on Apple Silicon Mac
   - Test on Intel Mac (if available)
   - Verify universal binary or separate builds work

4. **Integration testing** (~1 hour)
   - Run full test suite: `npm run test:all`
   - Test OCR with scanned PDFs
   - Test embedding generation
   - Test search functionality

5. **Documentation updates** (~1 hour)
   - Update `docs/guides/python-setup.md` (now simpler)
   - Update `CLAUDE.md` technology stack section
   - Update `README.md` installation instructions
   - Add release notes about zero-installation

6. **Build automation** (~1 hour)
   - Add bundling scripts to `package.json` scripts
   - Update CI/CD if applicable
   - Document build process for future releases

**Deliverable:** Production-ready app with zero-installation UX

---

## Part 4: Files to Create/Modify

### New Files

```
scripts/
├── bundle-python.sh          # Automate Python bundling
├── bundle-poppler.sh         # Automate Poppler bundling
└── optimize-python-bundle.sh # Strip and clean Python bundle

resources/
├── python/
│   ├── darwin-arm64/
│   │   └── venv/             # Python + dependencies
│   └── darwin-x64/
│       └── venv/
└── poppler/
    ├── darwin-arm64/
    │   ├── pdftoppm
    │   ├── pdfinfo
    │   ├── lib/              # Bundled dylibs
    │   └── LICENSE           # GPL license
    └── darwin-x64/
        └── ...

docs/specs/
└── bundling-strategy.md      # This document
```

### Modified Files

```
package.json
- Add extraResources for Python and Poppler
- Add binaries for code signing
- Add build scripts

src/main/worker/PythonSidecarService.ts
- Update getDefaultPythonPath() for bundled Python
- Update getPythonEnv() to add Poppler to PATH
- Add DYLD_LIBRARY_PATH for Poppler libs
- Add fallback logic

docs/guides/python-setup.md
- Update for zero-installation approach
- Keep manual install as fallback option

CLAUDE.md
- Update technology stack section
- Update installation instructions
- Add bundling notes

README.md
- Update installation instructions
- Mention zero-installation UX
- Update system requirements
```

---

## Part 5: Testing Checklist

### Pre-Build Testing

- [ ] Bundled Python runs: `resources/python/darwin-arm64/venv/bin/python3 --version`
- [ ] PyTorch imports: `python3 -c "import torch; print(torch.__version__)"`
- [ ] Transformers imports: `python3 -c "import transformers"`
- [ ] Bundled Poppler runs: `DYLD_LIBRARY_PATH=resources/poppler/darwin-arm64/lib resources/poppler/darwin-arm64/pdftoppm -v`
- [ ] Bundle size <300MB: `du -sh resources/`

### Build Testing

- [ ] Build succeeds: `npm run package`
- [ ] App bundle size acceptable (<2GB)
- [ ] Code signing succeeds (check with `codesign -dvv`)
- [ ] Notarization succeeds (check with `spctl -a -t exec -vv`)

### Functional Testing (Clean Mac)

- [ ] App installs successfully (drag to Applications)
- [ ] App launches without errors
- [ ] Embedding service starts automatically
- [ ] Model downloads on first run (~450MB)
- [ ] Folders can be added for indexing
- [ ] PDF files are parsed correctly
- [ ] OCR works on scanned PDFs
- [ ] Search returns relevant results
- [ ] No "Python not found" errors
- [ ] No "Poppler not found" errors

### Platform Testing

- [ ] Works on Apple Silicon (M1/M2/M3)
- [ ] Works on Intel Mac
- [ ] Universal binary size reasonable (if using universal approach)

### Performance Testing

- [ ] App startup time acceptable (<5s to main window)
- [ ] Embedding service startup <10s
- [ ] No memory leaks from bundled Python
- [ ] OCR performance unchanged

### Regression Testing

- [ ] All unit tests pass: `npm run test:unit`
- [ ] All integration tests pass: `npm run test:integration`
- [ ] All E2E tests pass: `npm run test:e2e`

---

## Part 6: Decision Factors

### When to Bundle (Recommended)

✅ **Preparing for public release**
- Zero-installation UX is critical
- Professional first impression
- Reduce support burden

✅ **Targeting non-technical users**
- Command-line setup is a barrier
- Homebrew not installed by default

✅ **App Store distribution**
- Cannot require external dependencies
- Must be self-contained

✅ **Enterprise deployment**
- Consistent environment across users
- No dependency management needed

### When NOT to Bundle

❌ **Early development/beta**
- Manual install is acceptable for beta testers
- Easier to iterate on Python code
- Smaller download for frequent updates

❌ **Targeting developers only**
- Already have Python/Homebrew
- Prefer to manage own environment

❌ **Storage is critical concern**
- Limited disk space on target systems
- 300MB is too large for use case

---

## Part 7: Comparison with Other Apps

### Desktop App Bundle Sizes (for reference)

| App | Size | Notes |
|-----|------|-------|
| **VS Code** | ~300-500MB | Electron app, includes Monaco editor |
| **Slack** | ~200-400MB | Electron app |
| **Docker Desktop** | ~600MB-1GB | Includes VM and containers |
| **Xcode** | ~12GB | Full IDE with SDKs |
| **Microsoft Office** | ~2-4GB | Full productivity suite |
| **Adobe Creative Cloud** | 1-2GB per app | Professional tools |

**Semantica (bundled):** ~510-520MB
- Comparable to VS Code and Slack
- Reasonable for a productivity app with ML capabilities
- Smaller than Docker Desktop, much smaller than Xcode/Office

---

## Part 8: Rollout Strategy

### Option A: Immediate Switch (Recommended)

**For next release:**
- Bundle Python and Poppler
- Remove manual installation instructions
- Update documentation
- Add release note: "Now with zero-installation setup!"

**Pros:**
- Clean break, no confusion
- Better user experience immediately
- Simplified support

**Cons:**
- Existing users download 300MB update
- Need to test thoroughly before release

### Option B: Phased Rollout

**Phase 1:** Bundle Python, keep Poppler manual
- Reduces risk (smaller change)
- Still requires one manual step

**Phase 2:** Add Poppler bundling later
- Complete zero-installation

**Pros:**
- Lower risk
- Can validate Python bundling first

**Cons:**
- Two releases needed
- Doesn't fully solve problem

### Option C: Hybrid Distribution

**Offer two DMG files:**
1. **Semantica (Standard)** - 510MB, zero-installation
2. **Semantica (Lite)** - 220MB, requires Python/Poppler

**Pros:**
- Serves both audiences
- Power users can choose

**Cons:**
- Doubled testing/maintenance burden
- User confusion about which to download
- Two support paths

**Recommendation:** Option A for simplicity and best UX

---

## Part 9: Alternatives Considered

### Alternative 1: Docker Container

**Approach:** Ship Python + ML model in Docker container

**Pros:**
- Complete isolation
- Easy to update

**Cons:**
- Requires Docker Desktop (~600MB)
- Adds 500MB+ Docker image
- Slower startup
- More complex architecture
- Docker not installed by default on Mac

**Decision:** Too heavy for this use case

### Alternative 2: Serverless Embeddings

**Approach:** Call cloud API for embeddings (OpenAI, Cohere, etc.)

**Pros:**
- No bundling needed
- Always up-to-date models
- No local compute

**Cons:**
- Not offline (core value prop)
- Privacy concerns
- Ongoing costs
- Latency for every search

**Decision:** Conflicts with "100% offline" positioning

### Alternative 3: WebAssembly

**Approach:** Compile Python + PyTorch to WASM

**Pros:**
- Runs in Electron renderer
- No separate process

**Cons:**
- PyTorch WASM support is experimental
- Performance overhead
- Large WASM file
- Limited ecosystem support

**Decision:** Too experimental, not ready for production

### Alternative 4: Keep Manual Installation

**Approach:** Continue current approach

**Pros:**
- Zero bundle size impact
- Easy to iterate

**Cons:**
- Poor user experience
- Support burden
- Not suitable for public release

**Decision:** OK for beta, not acceptable for 1.0

---

## Part 10: Risks & Mitigations

### Risk 1: Bundle Size Too Large

**Impact:** Users hesitate to download 500MB app

**Likelihood:** Low (comparable to other desktop apps)

**Mitigation:**
- Optimize aggressively (<300MB addition)
- Clearly state "large download" on website
- Explain why (offline ML capabilities)
- Offer progress bar during download

### Risk 2: Code Signing Issues

**Impact:** App won't run due to Gatekeeper

**Likelihood:** Medium (many binaries to sign)

**Mitigation:**
- Test signing thoroughly before release
- Use electron-builder's automatic signing
- Test on clean Mac after notarization
- Have backup plan to fix and re-release

### Risk 3: Platform-Specific Bugs

**Impact:** Works on ARM but not Intel (or vice versa)

**Likelihood:** Medium

**Mitigation:**
- Test on both platforms before release
- Use CI/CD to build for both architectures
- Have beta testers on both platforms
- Document known issues in release notes

### Risk 4: Update Complexity

**Impact:** Every Python update requires full app update

**Likelihood:** High (by design)

**Mitigation:**
- Document Python/Poppler versions in codebase
- Schedule updates with app releases
- Monitor for security vulnerabilities
- Can add external update mechanism later if needed

### Risk 5: License Violation

**Impact:** GPL obligations not met

**Likelihood:** Low (subprocess model should be fine)

**Mitigation:**
- Include Poppler's GPL license in bundle
- Add attribution to about screen
- Document subprocess architecture
- Consult legal counsel for final approval

### Risk 6: Increased Build Complexity

**Impact:** Builds take longer, fail more often

**Likelihood:** Medium

**Mitigation:**
- Automate bundling with scripts
- Add to CI/CD pipeline
- Document build process thoroughly
- Test builds frequently during development

---

## Part 11: Success Metrics

### User Experience Metrics

**Before (Manual Install):**
- Time to first search: 10-20 minutes
- Technical steps required: 3-4
- Support tickets about installation: ~30% of total

**After (Bundled):**
- Time to first search: 5-7 minutes (model download only)
- Technical steps required: 0
- Expected support tickets: <10%

### Technical Metrics

**Bundle size:**
- Target: <300MB addition
- Acceptable: <350MB addition
- Maximum: <400MB addition

**Performance:**
- App startup: <5s (no degradation)
- Embedding service startup: <10s (no degradation)
- OCR processing: unchanged

**Reliability:**
- Zero "Python not found" errors
- Zero "Poppler not found" errors
- 100% of users can use OCR out-of-box

---

## Part 12: Post-Implementation

### Monitoring

**Watch for:**
- Bundle size growth over time
- Python/Poppler security vulnerabilities
- User complaints about download size
- Code signing/notarization failures

### Maintenance

**Regular tasks:**
- Update Python runtime (every 6-12 months)
- Update PyTorch/transformers (every 3-6 months)
- Monitor Poppler releases
- Review dependencies for security issues

**Automation:**
- Dependabot alerts for Python packages
- Automated bundling in CI/CD
- Automated size checks
- Notarization status monitoring

### Future Enhancements

**Possible improvements:**
1. **Differential updates** - Only download changed files
2. **Lazy loading** - Download Python/Poppler on first use
3. **Multiple models** - Let users choose model size/quality
4. **Plugin system** - Let users add custom parsers without full update
5. **Auto-update** - Keep Python/Poppler updated independently

---

## Part 13: Recommendations

### For Public Release (v1.0+)

✅ **Bundle Python + Poppler**
- Professional UX required
- 300MB is reasonable for desktop ML app
- Eliminates major support burden

### For Current Beta

⚠️ **Manual install is OK**
- Beta testers can handle technical setup
- Easier to iterate on Python code
- Save bundling for public release

### Implementation Approach

1. **Start with Python bundling** (Days 1-2)
   - Larger component, more critical
   - Validate approach before adding Poppler

2. **Add Poppler bundling** (Day 2)
   - Smaller, simpler addition
   - Can be added incrementally

3. **Test thoroughly** (Day 3)
   - Don't rush to production
   - Get beta testers on clean Macs

4. **Document everything**
   - Future maintainers need context
   - Build process must be repeatable

---

## Part 14: Next Steps

### If Proceeding with Bundling:

1. **Review this document** - Ensure approach is sound
2. **Get approval** - Confirm bundle size is acceptable
3. **Start Day 1** - Begin Python bundling
4. **Daily check-ins** - Review progress and blockers
5. **Beta test** - Get clean Mac testers before release

### If Deferring Bundling:

1. **Document decision** - Add note to this file
2. **Revisit timeline** - When to implement?
3. **Improve manual install** - Better setup docs
4. **Plan for future** - Keep this spec up-to-date

---

## Appendix A: Key Code Locations

### Python Sidecar

- **Service:** `src/main/worker/PythonSidecarService.ts`
- **Server:** `embedding_sidecar/embed_server.py`
- **Requirements:** `embedding_sidecar/requirements.txt`
- **Dependency check:** `embedding_sidecar/check_deps.py`

### Poppler Usage

- **OCR implementation:** `embedding_sidecar/embed_server.py:352-372`
- **Dependency check:** `embedding_sidecar/check_deps.py:40-49`

### Build Configuration

- **Package config:** `package.json:140-160` (build section)
- **TypeScript config:** `tsconfig.json`

### Documentation

- **Python sidecar spec:** `docs/specs/python-sidecar.md`
- **OCR feature spec:** `docs/specs/ocr-feature.md`
- **Setup guide:** `docs/guides/python-setup.md`

---

## Appendix B: Reference Links

### Python

- **Python.org downloads:** https://www.python.org/downloads/macos/
- **Python embedding guide:** https://docs.python.org/3/extending/embedding.html
- **PyTorch downloads:** https://pytorch.org/get-started/locally/

### Poppler

- **Poppler homepage:** https://poppler.freedesktop.org/
- **pdf2image (Python wrapper):** https://pypi.org/project/pdf2image/
- **Zotero's cross-poppler:** https://github.com/zotero/cross-poppler

### Electron/Build

- **electron-builder docs:** https://www.electron.build/
- **Code signing guide:** https://www.electron.build/code-signing
- **Notarization guide:** https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/

### Tools

- **dylibbundler:** https://github.com/auriamg/macdylibbundler
- **install_name_tool:** `man install_name_tool` (ships with Xcode)

---

## Appendix C: Frequently Asked Questions

### Q: Does bundling lose GPU acceleration?

**A: No.** GPU acceleration is fully preserved with bundling.

**Details:**
- Semantica currently uses Apple Silicon GPU via MPS (Metal Performance Shaders)
- Device auto-detection: MPS > CUDA > CPU (code: `embed_server.py:74-84`)
- Bundled PyTorch includes both CPU and MPS support (standard macOS wheel)
- Performance remains identical: 55-93 texts/sec on Apple Silicon
- No separate "CPU-only" PyTorch build exists for macOS

**Summary:** Bundling changes nothing about GPU support - it works exactly the same as manual installation.

### Q: What about Intel Macs?

**A:** Intel Macs use CPU backend (no MPS support), which also works identically with bundled vs manual installation.

### Q: Can I force CPU-only mode?

**A:** Yes, though not recommended. You can modify `embed_server.py:74-84` to always return `"cpu"` instead of checking for MPS. However, this will reduce performance on Apple Silicon Macs.

### Q: Does MPS make a significant performance difference?

**A:** Modest improvement (~30% estimated) plus better energy efficiency. Current throughput of 55-93 texts/sec is excellent for the use case. The main benefit is energy efficiency (lower power consumption) rather than raw speed.

---

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2025-11-04 | 1.0 | Initial comprehensive bundling strategy |
| 2025-11-04 | 1.1 | Clarified GPU/MPS support is preserved with bundling; fixed misleading "CPU-only build" references |

---

**End of Document**
