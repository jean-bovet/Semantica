# Specs vs Code Alignment Report

> **OUTDATED - Pre-Python Sidecar Migration**
>
> **Date:** 2025-09-01
> **Status:** This audit was conducted before the Python sidecar migration (Oct 2025)
>
> **Major Changes Since This Audit:**
> - **EmbedderPool** → Removed, replaced with Python sidecar HTTP client
> - **Model download** → Now handled by Python sentence-transformers automatically
> - **Embedder process** → Now FastAPI HTTP server on port 8421
> - **Ollama support** → Removed
> - **Transformers.js/ONNX** → Removed
>
> **Recommendation:** Archive this document and create new alignment audit post-Python sidecar if needed.

Date: 2025-09-01

Scope: Review `specs/` against the implementation under `src/` to identify matches, divergences, and recommended documentation updates.

## Summary

- Architecture, build/distribution, auto-update, and model download flow are largely implemented as documented.
- Several API surface and flow details in the specs have drifted from the code (notably the preload API, startup responsibilities, parser versions, and supported formats).
- Recommended to refresh API Reference, Startup/Architecture notes, and Overview/Status dashboards to match current behavior.

## High-Level Matches

- Architecture: Multi-process Electron app with worker thread and isolated embeddings process implemented as documented.
  - Main: `src/main/main.ts` manages lifecycle, IPC, crash reporting, single-instance, auto-update.
  - Worker: `src/main/worker/index.ts` owns LanceDB, file scanning/indexing, model readiness gating.
  - Renderer: React UI with search-first design and progress/status UI.
- Build/Distribution:
  - electron-builder config, entitlements (`build/entitlements.mac.plist`), notarization hook (`scripts/notarize.js`), dotenv usage, and GitHub publishing match specs.
- Auto-update:
  - `electron-updater` + `electron-log` configured with initial delayed check and 30-minute interval, as described.
- Model download (first run):
  - Worker checks model presence and downloads sequentially with progress messages; renderer shows overlay and progress.

## Key Divergences

### 1) API Surface (specs/05-api-reference.md vs `src/main/preload.ts`)

- Missing/renamed methods:
  - Indexer (spec): `start`, `reindex(folders)`, `getFileStatus(path)`.
  - Indexer (code): `watchStart`, `enqueue`, `reindexAll`, `getWatchedFolders`, `searchFiles`, `onProgress`, `progress`, `pause`, `resume`.
  - Search (spec): `query(text, options?)`, `searchFiles`, `clearCache`.
  - Search (code): `query(q, k)` only; file search exposed under `indexer.searchFiles`.
  - Database (spec): `stats`, `clear`, `export`, `import`, `optimize`.
  - Database (code): `stats` only.
  - Config (spec): `config.get/set/reset`.
  - Settings (code): `settings.get/update`.
  - System (spec): `showInFinder`, `openFile`, `version`, `memoryUsage`, `restartWorker`.
  - System (code): `openPath`, `openPreview`, `getDataPath`.
  - Additional (code only): `dialog.selectFolders/confirm/error`, `model.check/download`, and generic `on/off` event helpers.

### 2) Startup & Model Download Responsibilities (specs/08-startup-flow.md)

- Spec implies a singleton embedder and that the embedder child downloads model files.
- Code uses an `EmbedderPool` (default pool size 2) for true parallelism and downloads model files in the worker (`src/main/worker/modelDownloader.ts`), while the child process simply loads from the cache. Progress events originate from the worker, not the child.

### 3) Parser Versions and Supported Formats (specs/03-implementation.md and specs/README.md)

- Text/Markdown parser:
  - Spec text highlights a “v3” multi-encoding parser; code implements `PARSER_VERSION = 4` with enhanced legacy encoding support (`src/main/parsers/text.ts`).
- Supported file types:
  - Code includes CSV/TSV (`src/main/parsers/csv.ts`) and Excel (XLSX/XLS/XLSM) (`src/main/parsers/xlsx.ts`) in the registry (`src/main/parsers/registry.ts`).
  - Specs’ top-level feature lists omit CSV/TSV and Excel.
- Status dashboard (specs/README.md) lists TXT/MD v1; actual versions: TXT/MD v4 (text parser), DOC v2, DOCX v1, PDF v1, RTF v1, CSV v1, TSV v1, Excel v1.

### 4) Memory Thresholds and Concurrency (specs/03-implementation.md)

- Concurrency:
  - Spec describes CPU-aware concurrency (cores-1, min 4; throttled cores/4, min 2) — matches `src/main/worker/cpuConcurrency.ts`.
  - Overview still references “5 files concurrently,” which is outdated given CPU-aware logic.
- Memory thresholds:
  - Spec examples mention embedder restart ~900MB RSS and ~500 files; code varies by context:
    - Worker embedder pool initialization often sets `maxMemoryMB: 1000` (see `src/main/worker/index.ts`).
    - Shared singleton helper (`src/shared/embeddings/isolated.ts`) uses `maxMemoryMB: 1500` and higher filesBeforeRestart.
  - Recommend documenting these as configurable with current defaults, or aligning values.

### 5) Project Structure (specs/01-overview.md)

- Spec shows `app/electron` and `app/renderer` structure; code uses `src/main`, `src/renderer`, `src/shared`.

## Smaller Drifts and Confirmations

- System, logs, and crash reporting paths align; crash reporter enabled in main and Crashpad saved under user data.
- Build optimization spec describes progress plumbing via child; real code forwards download progress from worker — UI outcome is the same, but wording could be updated.
- Parser versioning and auto re-indexing: Implemented via central parser registry and worker logic; consistent with intent.

## Recommended Documentation Updates

1) Update API Reference (specs/05-api-reference.md)
- Reflect actual `window.api` surface:
  - Indexer: `watchStart`, `enqueue`, `pause`, `resume`, `progress`, `onProgress`, `getWatchedFolders`, `reindexAll`, `searchFiles`.
  - Search: `query(q: string, k?: number)`; decide whether to add `clearCache` to code or remove from spec.
  - Database: trim to `stats` or implement the rest.
  - Replace `config.*` with `settings.get/update`.
  - System: `openPath`, `openPreview`, `getDataPath`.
  - Add `dialog.*`, `model.check/download`, and `on/off` event helpers.

2) Align Startup/Architecture Notes (specs/08-startup-flow.md and specs/02-architecture.md)
- Document `EmbedderPool` (pool size from config) instead of a hard singleton.
- Clarify that the worker downloads model files sequentially and emits progress; the child loads from the cache.

3) Synchronize Parser Versions and Supported Formats
- Update Text/Markdown parser to v4 in docs.
- Add CSV/TSV and Excel to supported formats, with versions and quick notes.
- Ensure status dashboards reflect actual versions and capabilities.

4) Concurrency and Thresholds
- Replace fixed “5 files” claims with CPU-aware concurrency description.
- Either standardize memory thresholds across contexts or explicitly document current defaults (e.g., 1000–1500MB RSS, filesBeforeRestart 500–5000 depending on pool/singleton).

5) Project Structure
- Update Overview project structure to `src/main`, `src/renderer`, `src/shared`.

## Optional Code Adjustments (if preferring spec parity)

- Expose convenience methods to match the API spec (e.g., `config.get/set/reset`, `system.showInFinder/openFile`, `search.clearCache`) or simplify the spec to the current surface.
- Unify embedder memory thresholds between `src/main/worker/index.ts` and `src/shared/embeddings/isolated.ts` to a single documented default.

## Next Steps

- If approved, I can:
  - Patch `specs/05-api-reference.md` to mirror the current preload API.
  - Update `specs/01-overview.md` and `specs/README.md` for structure, versions, and supported formats.
  - Adjust `specs/08-startup-flow.md` and `specs/02-architecture.md` to reflect the embedder pool and worker-driven model downloads.

