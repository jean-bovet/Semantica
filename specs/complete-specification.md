# Offline Mac Search App — Complete Technical Specification
## Electron + TypeScript + LanceDB

**Goal:** Ship a notarized macOS app that indexes user-selected folders, creates local embeddings on-device, and serves fast semantic search—**no data leaves the device**.

**Audience:** You (dev) + AI coding assistants (Claude Code).
**Status:** Implementation-ready specification with testing strategy.
**Privacy:** 100% offline. No telemetry by default.

---

## Part 1: Application Specification

## 1) Product Scope

### 1.1 Core Features (MVP)

* Folder picker (multiple roots).
* Incremental indexer with file watching (PDF, TXT, MD).
* Chunking (heading/sentence-aware heuristic), 300–800 tokens, overlap ~50.
* On-device embeddings (E5-small or MiniLM, quantized).
* Vector store: **LanceDB** in app data folder.
* ANN search (cosine), results grouped by file with page and snippet.
* Pause/Resume indexing, progress indicators.
* Open-in-Finder / Open-in-Preview.

### 1.2 Non-Goals (MVP)

* Cloud APIs (none).
* Mobile builds.
* OCR by default (optional add-on later).
* App Store sandboxing (v1 ships as notarized DMG outside store).

---

## 2) Architecture

### 2.1 High-Level

```
Electron (TS/Node)
├─ main process
│  ├─ app lifecycle + window
│  ├─ secure IPC bridge (preload)
│  ├─ DB host (LanceDB)
│  └─ spawns Indexer Worker (Node worker_threads)
├─ preload (exposes typed API to renderer)
└─ renderer (React/TS UI)
```

### 2.2 Processes & Responsibilities

* **Main**: Window creation, IPC endpoints, LanceDB initialization, search execution, model loader configuration, notarization-safe FS paths.
* **Indexer Worker**: Watch folders, parse files, chunk, embed, upsert vectors/metadata—throttled and resumable.
* **Renderer**: UI (search bar, results, settings, progress).

---

## 3) Technology Choices

* **Electron** + **TypeScript**
* UI: React (or minimal TS + DOM; up to you)
* File watch: `chokidar`
* PDFs: `pdfjs-dist` (Node usage)
* Text/MD: native `fs` + optional `remark` pipeline
* Embeddings (local CPU): `@xenova/transformers` (quantized)
* Vector DB: **LanceDB** (`vectordb` package)
* Hashing: `crypto` (SHA-1) for deterministic chunk IDs
* Job queue: in-memory array + small state store (LanceDB/SQLite/JSON) for resumability

---

## 4) Data Model

### 4.1 LanceDB Table `chunks`

| Column   | Type        | Notes                                |
| -------- | ----------- | ------------------------------------ |
| `id`     | TEXT (PK)   | `sha1(path:page:offset)`             |
| `path`   | TEXT        | absolute path                        |
| `mtime`  | FLOAT64     | file modified time (ms)              |
| `page`   | INT         | page number (PDF) or 0               |
| `offset` | INT         | byte/char offset for snippet rebuild |
| `text`   | TEXT        | chunked text                         |
| `vector` | VECTOR(384) | normalized embedding                 |
| `type`   | TEXT        | `pdf | txt | md | …` (optional)      |
| `title`  | TEXT        | filename or doc title (optional)     |

**Indexes:** LanceDB manages ANN index internally; `id` as primary key for upserts.

### 4.2 App Paths

```
~/Library/Application Support/YourApp/
  data/        # LanceDB storage
  models/      # local model weights (bundled)
  logs/
```

---

## 5) Indexing Pipeline

1. **Discover**
   * User picks folders via native dialog.
   * Persist roots + include/exclude globs.
   * `chokidar` watches add/change/unlink events.

2. **Parse**
   * PDF: extract text per page with `pdfjs-dist` (no images).
   * TXT/MD: read file; optional Markdown strip while preserving headings.
   * Stream where possible; avoid loading huge files entirely.

3. **Chunk**
   * Sentence-aware split (`/(?<=[.!?])\s+/`).
   * Target `~500` tokens, overlap `~60`.
   * Compute `offset` to enable snippet reconstruction.

4. **Embed**
   * Batch size 32–64 chunks per pass.
   * Normalize vectors (cosine).
   * Cache by chunk `id` to avoid recompute if unchanged.

5. **Upsert**
   * Write chunks + vectors into `chunks` with primary key `id`.
   * Maintain a per-file digest (`sha1` of bytes) to skip unchanged files.

6. **Progress/Control**
   * Worker posts progress updates over `parentPort`.
   * Controls: `pause/resume`, backpressure (sleep 5–20 ms between batches).

---

## 6) Search Flow

* Query → embed (same local model) → ANN top-k (e.g., 50–100).
* Light re-rank by cosine (already normalized).
* Snippet build: center around `offset` with ±N chars; highlight query tokens.
* Group results by `path` with per-file top hits.

---

## 7) IPC Contract (Typed)

**Channel names** (all `ipcRenderer.invoke` → `ipcMain.handle`)

* `indexer:enqueue(paths: string[])`
* `indexer:watchStart(roots: string[], options: {include: string[]; exclude: string[]})`
* `indexer:pause()`
* `indexer:resume()`
* `indexer:progress(): Promise<{queued:number; processing:number; done:number; errors:number}>`
* `search:query({ q: string, k?: number, filters?: {...} }): Promise<SearchHit[]>`
* `settings:get()` / `settings:update(partial)`
* `system:openPath(path: string)` (open in Finder)
* `system:openPreview(path: string, page?: number)`

**`SearchHit`**

```ts
type SearchHit = {
  id: string;
  path: string;
  page: number;
  offset: number;
  text: string;
  score: number; // cosine similarity
};
```

---

## 8) Security & Offline Guarantees

* **No network**: Do not import any code that fetches remote models.
  * Set `transformers.env.allowLocalModels = true` and **local model path only**.
* Electron security:
  * `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true (renderer)`.
  * Minimal `preload` API surface; validate inputs server-side (main).
* Scope indexing to **user-selected folders only**.
* Respect macOS privacy: do not request Full Disk Access; rely on user folder choices.
* Encryption-at-rest: rely on FileVault (default). You can add SQLCipher later if required → then consider SQLite instead of LanceDB.

---

## 9) Performance Guidelines

* Batch embedding: 32–64 chunks.
* Throttle CPU: configurable sleep between batches.
* Skip re-index if `mtime` + `digest` unchanged.
* Memory guard: cap concurrent files; stream PDFs.
* Target first-index throughput: ~200–600 chunks/min on typical laptop CPU (varies by model).

---

## 10) Packaging/Distribution

* Use `electron-builder` to produce **universal or arm64** DMG.
* **Hardened Runtime** + **Notarization** (Apple ID/API key).
* `extraResources` for `models/` and optionally `data/` seed files.
* Unpack large models: `asarUnpack` for model folder if needed.

**`electron-builder` snippet (package.json)**

```json
{
  "build": {
    "appId": "com.yourorg.offlinesearch",
    "mac": {
      "category": "public.app-category.productivity",
      "hardenedRuntime": true,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist",
      "target": ["dmg"],
      "gatekeeperAssess": false
    },
    "files": [
      "dist/**",
      "!**/*.map"
    ],
    "extraResources": [
      { "from": "resources/models", "to": "models", "filter": ["**/*"] }
    ],
    "asarUnpack": [
      "resources/models/**"
    ]
  }
}
```

---

## 11) Project Structure

```
/app
  /electron
    main.ts
    preload.ts
    /indexer
      worker.ts
      queue.ts
    /db
      store.ts
    /parsers
      pdf.ts
      text.ts
    /embeddings
      local.ts
    /pipeline
      chunker.ts
  /renderer
    App.tsx
    SearchView.tsx
    SettingsView.tsx
    hooks/useSearch.ts
  /resources
    /models/intfloat-e5-small/   # or MiniLM, quantized ONNX
  /tests
    /unit
      chunker.spec.ts
      id.spec.ts
      pdf-parser.spec.ts
      text-parser.spec.ts
      embeddings-adapter.spec.ts
      lancedb-wrapper.spec.ts
      ipc-contract.spec.ts
    /integration
      index-pipeline.spec.ts
      reindex-changed-file.spec.ts
      search-ranking.spec.ts
      unlink-remove.spec.ts
      concurrency.spec.ts
      resume-after-crash.spec.ts
    /e2e
      app.e2e.spec.ts
    /fixtures
      pdfs/ (small PDFs, edge cases)
      texts/ (md, txt)
      goldens/ (expected JSON/text snapshots)
    /helpers
      tmpdir.ts
      no-network.ts
      mock-embeddings.ts
      spawn-electron.ts
  package.json
  tsconfig.json
```

---

## 12) Key Implementation Sketches

### 12.1 LanceDB Init & Search

```ts
// electron/db/store.ts
import * as lancedb from 'vectordb';
import { embed } from '../embeddings/local';

let table: any;

export async function initDB(dir: string) {
  const db = await lancedb.connect(dir);
  table = await db.createTable('chunks', {
    id: lancedb.Text(),
    path: lancedb.Text(),
    mtime: lancedb.Float64(),
    page: lancedb.Int(),
    offset: lancedb.Int(),
    text: lancedb.Text(),
    vector: lancedb.Vector(384),
  }, { ifNotExists: true, primaryKey: 'id' });
}

export async function upsert(rows: any[]) {
  await table.add(rows, { mode: 'overwrite', primaryKey: 'id' });
}

export async function search(q: string, k = 10) {
  const [qvec] = await embed([q]);
  return table.search(qvec)
    .limit(k)
    .select(['id','path','page','offset','text','_distance']) // _distance if supported
    .execute();
}
```

### 12.2 Local Embeddings (Transformers.js)

```ts
// electron/embeddings/local.ts
import { env, pipeline } from '@xenova/transformers';
import path from 'node:path';
import { app } from 'electron';

env.allowLocalModels = true;
env.localModelPath = path.join(process.resourcesPath, 'models'); // packed via extraResources

let embedderPromise: Promise<any> | null = null;

async function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', 'intfloat/e5-small', { quantized: true });
  }
  return embedderPromise;
}

// Allow dependency injection for testing
export type EmbedFn = (texts: string[]) => Promise<number[][]>;
let embedImpl: EmbedFn | null = null;

export function setEmbedImpl(fn: EmbedFn) { 
  embedImpl = fn; 
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (embedImpl) {
    return embedImpl(texts); // Use mock in tests
  }
  
  // Production implementation
  const pipe = await getEmbedder();
  const out = await pipe(texts, { pooling: 'mean', normalize: true });
  const data = out.data as Float32Array;
  const dim = out.dims.at(-1) ?? 384;
  const vectors: number[][] = [];
  for (let i = 0; i < data.length; i += dim) {
    vectors.push(Array.from(data.slice(i, i + dim)));
  }
  return vectors;
}
```

### 12.3 PDF Parsing

```ts
// electron/parsers/pdf.ts
import * as pdfjs from 'pdfjs-dist';
import { getDocument } from 'pdfjs-dist';

export async function parsePdf(filePath: string) {
  const pdf = await getDocument({ url: filePath, useSystemFonts: true }).promise;
  const pages: { page: number; text: string }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const tc = await p.getTextContent();
    const text = tc.items.map((it: any) => it.str).join(' ');
    pages.push({ page: i, text });
  }
  await pdf.cleanup();
  return pages;
}
```

### 12.4 Chunker

```ts
// electron/pipeline/chunker.ts
export function chunkText(text: string, target = 500, overlap = 60) {
  const sents = text.split(/(?<=[.!?])\s+/);
  const chunks: { text: string; offset: number }[] = [];
  const tok = (s: string) => Math.ceil(s.length / 4); // heuristic
  let buf: string[] = [], off = 0, len = 0;

  for (const s of sents) {
    const t = tok(s);
    if (len + t > target && buf.length) {
      const joined = buf.join(' ');
      chunks.push({ text: joined, offset: off });
      while (buf.length && tok(buf.join(' ')) > overlap) buf.shift();
      off += joined.length + 1;
      len = tok(buf.join(' '));
    }
    buf.push(s); len += t;
  }
  if (buf.length) chunks.push({ text: buf.join(' '), offset: off });
  return chunks;
}
```

### 12.5 Worker Loop

```ts
// electron/indexer/worker.ts
import { parentPort } from 'node:worker_threads';
import chokidar from 'chokidar';
import { statSync, readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { parsePdf } from '../parsers/pdf';
import { chunkText } from '../pipeline/chunker';
import { embed } from '../embeddings/local';
import { upsert } from '../db/store';

let paused = false;
const q: string[] = [];

parentPort!.on('message', (m: any) => {
  if (m.type === 'enqueue') q.push(...m.paths);
  if (m.type === 'pause') paused = true;
  if (m.type === 'resume') paused = false;
  if (m.type === 'watchStart') {
    const { roots, options } = m;
    const watcher = chokidar.watch(roots, { ignored: options?.exclude, ignoreInitial: true });
    watcher.on('add', p => q.push(p));
    watcher.on('change', p => q.push(p));
    watcher.on('unlink', p => /* TODO: remove rows for this path */ null);
  }
  if (m.type === 'get-progress') parentPort!.postMessage({ type: 'progress', payload: { queued: q.length, processing: 0, done: 0, errors: 0 }});
});

async function handleFile(p: string) {
  const mtime = statSync(p).mtimeMs;
  const ext = p.toLowerCase().split('.').pop();
  if (ext === 'pdf') {
    const pages = await parsePdf(p);
    for (const pg of pages) {
      const chunks = chunkText(pg.text, 500, 60);
      const ids = chunks.map(c => crypto.createHash('sha1').update(`${p}:${pg.page}:${c.offset}`).digest('hex'));
      const vecs = await embed(chunks.map(c => c.text));
      await upsert(chunks.map((c, i) => ({
        id: ids[i], path: p, mtime, page: pg.page, offset: c.offset, text: c.text, vector: vecs[i]
      })));
    }
  } else if (ext === 'txt' || ext === 'md') {
    const text = readFileSync(p, 'utf8');
    const chunks = chunkText(text, 500, 60);
    const ids = chunks.map(c => crypto.createHash('sha1').update(`${p}:0:${c.offset}`).digest('hex'));
    const vecs = await embed(chunks.map(c => c.text));
    await upsert(chunks.map((c, i) => ({
      id: ids[i], path: p, mtime, page: 0, offset: c.offset, text: c.text, vector: vecs[i]
    })));
  }
}

async function loop() {
  while (true) {
    if (paused || q.length === 0) { await new Promise(r => setTimeout(r, 100)); continue; }
    const p = q.shift()!;
    try { await handleFile(p); } catch (e) { /* log */ }
    await new Promise(r => setTimeout(r, 10)); // throttle
    parentPort!.postMessage({ type: 'progress', payload: { queued: q.length, processing: 0, done: 1, errors: 0 }});
  }
}
loop();
```

---

## 13) UX Requirements

* **Search bar** with instant results (debounced 150–250 ms).
* **Filters**: file type, folder, date (phase 2).
* **Result cards**: snippet, page #, file title, "Open" buttons.
* **Indexing status**: queued/processing/done counts; pause/resume; last error.
* **Settings**:
  * Folders + include/exclude globs
  * CPU throttle (Low/Med/High)
  * Model selection (E5-small default)
  * Network: **locked to "Disabled"** (display-only)

---

## 14) Development Workflow & Commands

### 14.1 Development Experience

During development, you get:
* **Renderer (React + Vite)**: True HMR with Fast Refresh - state often survives edits
* **Main + Preload**: Auto-rebuild with esbuild/tsc and Electron auto-relaunches
* **Indexer Worker**: Auto-rebuild on change; main process kills & respawns the worker
* **No repackaging needed** - changes reflect instantly or with quick restart

### 14.2 What Reloads Live vs Restarts

* **Renderer**: Hot reload (HMR) — no restart; super fast
* **Preload**: Requires app restart (security context) - handled by electronmon
* **Main**: Requires app restart - handled by electronmon
* **Worker**: Just respawn (cheap; keep queue state in DB)

### 14.3 Commands & Scripts

* `dev`: Run Electron with live reload (HMR for UI, auto-restart for backend)
* `build`: Type-check + bundle all components
* `dist`: Create notarized DMG for distribution
* `test`: Run tests in watch mode
* `test:ci`: Run tests once (for CI)
* `test:e2e`: Run Playwright E2E tests
* `coverage`: Generate coverage report
* `postinstall`: Run `electron-rebuild` if native deps added

### 14.4 Package.json Configuration

```json
{
  "scripts": {
    "dev": "concurrently -k -n VITE,BUILD,ELEC -c blue,magenta,green \"vite\" \"node esbuild.watch.js\" \"wait-on tcp:5173 && electronmon .\"",
    "build": "tsc -b && node esbuild.build.js",
    "dist": "electron-builder",
    "test": "vitest",
    "test:ci": "vitest --run --reporter=dot",
    "test:e2e": "playwright test",
    "coverage": "vitest --run --coverage",
    "postinstall": "electron-builder install-app-deps"
  },
  "devDependencies": {
    "concurrently": "^9",
    "esbuild": "^0.23",
    "electronmon": "^2",
    "wait-on": "^8",
    "vite": "^5",
    "vitest": "^1",
    "playwright": "^1",
    "@playwright/test": "^1",
    "electron": "^33",
    "electron-builder": "^25",
    "typescript": "^5"
  }
}
```

### 14.5 Build Configuration (esbuild.watch.js)

```js
import { build, context } from 'esbuild';

async function watch(entry, outfile) {
  const ctx = await context({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    sourcemap: true
  });
  await ctx.watch();
}

// Watch and rebuild all components
await Promise.all([
  watch('app/electron/main.ts',     'dist/main.cjs'),
  watch('app/electron/preload.ts',  'dist/preload.cjs'),
  watch('app/electron/indexer/worker.ts', 'dist/worker.cjs')
]);
```

### 14.6 Main Process Dev Configuration

```ts
// main.ts - Handle dev vs production URLs
const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
  win.loadURL('http://localhost:5173');
  win.webContents.openDevTools(); // Auto-open DevTools in dev
} else {
  win.loadURL(`file://${path.join(__dirname, '../index.html')}`);
}

// Auto-respawn worker in dev
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';

let worker: Worker | null = null;
function spawnWorker() {
  worker?.terminate().catch(()=>{});
  worker = new Worker(path.join(__dirname, 'worker.cjs'));
}

spawnWorker();

// In dev: reload worker when its output changes
if (isDev) {
  const builtPath = path.join(__dirname, 'worker.cjs');
  fs.watch(builtPath, { persistent: false }, () => {
    console.log('Worker changed, respawning...');
    spawnWorker();
  });
}
```

### 14.7 Development Best Practices

* **DevTools**: Auto-open in development for debugging
* **Source Maps**: Enable for main/preload to map stack traces to TypeScript
* **Separate Dev Data**: Use `~/Library/Application Support/YourApp-dev/` for dev database
* **Model Caching**: Don't watch `resources/models` directory to avoid heavy reloads
* **DB Cleanup**: Close table handles properly before quit to avoid locks

### 14.8 Common Pitfalls & Fixes

| Issue | Fix |
|-------|-----|
| Renderer HMR works but main/preload edits don't reload | Ensure electronmon watches built files (`dist/*.cjs`) not sources |
| Worker not updating | Load from built path and ensure `fs.watch` respawn is active |
| Model reloads slow | Keep model path stable, don't watch models directory |
| LanceDB locks during restarts | Use predictable temp dir in dev, close handles before quit |

---

## Part 2: Testing Strategy

## 15) Test Pyramid

* **Unit (≈70%)**
  Pure functions/modules: chunker, PDF/text parsers (logic), ID/digest, embedding adapter (mocked), LanceDB wrapper (mocked), IPC validators.
* **Integration (≈25%)**
  Real LanceDB on a temp dir + real worker thread + mocked embeddings; parse→chunk→embed→upsert→search on a small fixture corpus.
* **End-to-End (≈5%)**
  Boot Electron app, add a fixture folder, wait for index, run a search through the UI; assert results & privacy (no network).

---

## 16) Testing Principles

* **Determinism:** seeded RNG for any randomization; stable fixture corpus; fixed model-dim (384).
* **Isolation:** temp directories for DB and caches; no writes outside test sandboxes.
* **No Network:** hard fail any outbound HTTP(S).
* **Fast by Default:** heavy tests (OCR, big corpora) behind `it.skipIfCI` or nightly workflow.
* **Golden Files:** for parser outputs/snippets to detect regressions.
* **Property-based checks:** for chunker (boundaries, overlaps, unicode).

---

## 17) Unit Tests (Vitest)

### 17.1 Chunker

**What:** sentence-aware chunking bounds, overlap, empty/small/huge inputs, unicode.
**Checks:**
* Chunks token size within target ± small margin
* Overlap tokens present between neighboring chunks
* Offsets are non-decreasing and within text length
* Idempotent: same input → same chunk set

**Example:**

```ts
import { describe, it, expect } from 'vitest';
import { chunkText } from '../../app/electron/pipeline/chunker';

describe('chunkText', () => {
  it('respects target and overlap', () => {
    const text = 'A. '.repeat(2000);
    const chunks = chunkText(text, 500, 60);
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i+1].offset).toBeGreaterThan(chunks[i].offset);
    }
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('handles unicode', () => {
    const text = '你好。こんにちは。🙂 End.';
    const chunks = chunkText(text, 10, 2);
    expect(chunks[0].text.length).toBeGreaterThan(0);
  });
});
```

### 17.2 ID/Digest

**What:** deterministic SHA-1 over `(path:page:offset)`; collision sanity.
**Checks:** equal inputs → equal IDs; different offsets → different IDs.

### 17.3 Parsers (PDF/Text)

**What:** pdfjs output normalization; removes excessive whitespace; preserves order.
**Technique:** compare against **golden JSON** (page→text) for small PDFs.

### 17.4 Embeddings Adapter

**What:** adapter returns vectors with correct shape and normalization.
**Approach:** **mock** model to return deterministic vectors for given inputs (e.g., seeded hash to 384-dim unit vectors).
**Checks:** cosine(vec, vec)=1; cosine(a,b) in [-1,1]; output length matches inputs.

### 17.5 LanceDB Wrapper

**What:** table schema creation, upsert-by-PK, simple query flow.
**Approach:** replace LanceDB with a **fake in-memory adapter** in unit tests (or spy around its API).

### 17.6 IPC Contract

**What:** runtime validation of payloads (zod or custom).
**Checks:** bad inputs rejected; good inputs pass.

---

## 18) Integration Tests (Vitest)

**Environment:** real LanceDB on a temp dir; real worker thread; **mocked embeddings** (fast, deterministic).

### 18.1 Parse→Chunk→Embed→Upsert→Search

* Feed 2 PDFs + 2 MD + 2 TXT fixtures.
* Wait for worker to drain queue.
* Query terms that should hit known chunks.
* Assert top-1/3 hits contain expected file/path/page and snippet.

### 18.2 Re-index on Change

* Index a file.
* Modify its content; ensure chunk IDs change appropriately and stale rows are replaced.
* Assert query finds *new* content; *old* content gone.

### 18.3 Deletion (unlink)

* Remove a file; ensure its rows are removed (implement removal API first).
* Assert search no longer returns that path.

### 18.4 Concurrency/Backpressure

* Enqueue 50 files (small fixtures).
* Ensure progress increases; no deadlocks; memory stays under threshold (track RSS).

### 18.5 Crash Recovery

* Kill worker mid-index (simulate crash).
* Restart pipeline; ensure idempotent upserts and no corruption.

---

## 19) End-to-End (Playwright)

**Scenario:**
* Launch Electron (headless off); choose fixture folder via a stubbed folder picker or injected setting.
* Wait for "Indexing complete" (UI indicator from IPC progress).
* Type a known query; verify UI list shows expected file/page/snippet; test "Open in Finder" is called with correct path (stub shell open).

**Privacy:**
* Load a **no-network hook** (see below) that fails any HTTP(S) request during E2E; run a search and observe zero network attempts.

---

## 20) Privacy: Block All Network

**Helper (`tests/helpers/no-network.ts`):**

```ts
import { afterAll, beforeAll } from 'vitest';
import { setGlobalDispatcher, Agent } from 'undici';

// An agent that throws on any request
class BlockAllAgent extends Agent {
  dispatch() {
    throw new Error('Network access is disabled in tests');
  }
}

export function installNoNetwork() {
  beforeAll(() => setGlobalDispatcher(new BlockAllAgent()));
  afterAll(() => setGlobalDispatcher(new Agent()));
}
```

**Usage in test setup:**

```ts
import { installNoNetwork } from './helpers/no-network';
installNoNetwork();
```

Also configure `@xenova/transformers`:

```ts
import { env } from '@xenova/transformers';
env.allowRemoteModels = false;
env.localModelPath = '/dev/null'; // tests mock embeddings anyway
```

---

## 21) Mocks & Fixtures

### 21.1 Mock Embeddings

**Goal:** fast, deterministic, no model loading.

```ts
// tests/helpers/mock-embeddings.ts
import crypto from 'node:crypto';

export function mockEmbed(texts: string[], dim = 384): number[][] {
  return texts.map(t => {
    const hash = crypto.createHash('sha1').update(t).digest();
    const v = new Float32Array(dim);
    for (let i = 0; i < dim; i++) v[i] = ((hash[i % hash.length] - 128) / 128);
    // normalize
    let norm = 0; for (let i = 0; i < dim; i++) norm += v[i]*v[i];
    norm = Math.sqrt(norm); for (let i = 0; i < dim; i++) v[i] /= norm || 1;
    return Array.from(v);
  });
}
```

### 21.2 Fixtures

* **PDFs:** tiny synthetic PDFs with known phrases: "the quick brown fox…". Include edge cases: ligatures, columns, long lines.
* **Texts/MD:** include headings (`#`, `##`) to test chunking around structure.
* **Goldens:** `fixtures/goldens/<file>.json` storing expected page texts and/or chunk arrays.

---

## 22) Electron E2E Harness (Playwright)

`tests/helpers/spawn-electron.ts`:

```ts
import { _electron as electron, ElectronApplication, Page } from 'playwright';

export async function launchApp(env: Record<string,string> = {}) {
  const app: ElectronApplication = await electron.launch({
    args: ['.'],
    env: { ...process.env, NODE_ENV: 'test', ...env }
  });
  const page: Page = await app.firstWindow();
  return { app, page };
}
```

`tests/e2e/app.e2e.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { launchApp } from '../helpers/spawn-electron';

test('index, search, and privacy', async () => {
  const { app, page } = await launchApp({ NO_NETWORK: '1', FIXTURE_DIR: __dirname + '/../fixtures' });
  await page.getByRole('button', { name: 'Add Folder' }).click();
  // In tests, stub folder picker to use FIXTURE_DIR
  await page.getByPlaceholder('Search...').fill('quick brown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('result-item').first()).toContainText('quick brown');
  await app.close();
});
```

**Note:** For folder picker, inject a test flag that bypasses the native dialog and sets folders directly via IPC.

---

## 23) Performance Tests (optional in CI, nightly preferred)

* **Index throughput:** N chunks/min on M-series (baseline, e.g., 400±20%).
* **Query latency:** p50/p95 for k=10 over 50k chunks (with mocked embeddings).
* Fail build if **regression > 30%** from baseline (stored in a JSON and updated intentionally with review).

---

## 24) Coverage

* **Thresholds:**
  * Statements ≥ 90%
  * Branches ≥ 85%
  * Lines ≥ 90%
* **Exclusions:** preload type shims, OS-specific launchers.

Add to `vitest.config.ts`:

```ts
coverage: {
  provider: 'istanbul',
  reporter: ['text', 'lcov'],
  lines: 90,
  statements: 90,
  branches: 85,
}
```

---

## 25) CI (GitHub Actions) — macOS Runner

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [ main ] }
  pull_request:
jobs:
  test:
    runs-on: macos-13
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build
      - name: Unit + Integration
        run: npm run test:ci
      - name: E2E (Electron)
        run: npm run test:e2e
```

Playwright needs its deps installed once:

```
npx playwright install --with-deps
```

(Do this in a setup step or pre-cache.)

---

## 26) Reliability Scenarios

* **Paused during embed batch** → resume continues without duplicate upserts.
* **Partial file write** (simulate temp writes) → parser rejects until stable `mtime`.
* **Locked file** → retry policy with exponential backoff, logs recorded.
* **DB lock** (rare with LanceDB) → retry or backoff with warning.

Each scenario should have an integration test.

---

## 27) What to Gate on PRs

* All unit+integration tests green.
* Coverage thresholds met.
* E2E basic path green.
* No network test passes.
* Lint/typecheck pass.

---

## 28) Milestones

1. **Week 1**: Project scaffold, Electron security, LanceDB init, local model load, manual "index file" command.
2. **Week 2**: Folder picker, watcher, index queue, PDF/TXT/MD parsers, search UI.
3. **Week 3**: Progress UI, pause/resume, result grouping, open-in-Preview/Finder, notarized DMG.

---

## 29) Done Criteria (MVP)

* Indexes selected folders; re-indexes on change; no crashes on large PDFs.
* Search returns relevant hits in <200 ms for ~50k chunks on M-series CPU.
* No outbound network traffic during indexing/search (verified).
* Notarized DMG installs and runs on macOS 13+ (Intel optional).
* Clear privacy statement: all local, no telemetry.

---

## 30) Risks & Mitigations

* **PDF text quality** (pdf.js quirks) → allow switching to alternative parser later; consider PDFKit native plugin if needed.
* **Embedding speed** → keep quantized model; allow batch size tuning.
* **Large corpora** → paginate indexing; show ETA; allow per-folder rules.
* **Binary scans** → optional OCR toggle later (tesseract.js).
* **Model packaging size** → ship one small model by default; add "Advanced: import local model" UI later.

---

## 31) Future Enhancements (Post-MVP)

* OCR (tesseract.js), toggle per folder.
* Cross-encoder re-ranker (local ONNX) for top-20.
* Rich previews (page image thumbnails).
* Encrypted store option (switch to SQLite+SQLCipher or encrypt LanceDB directory at OS level).
* App Store build (sandbox adaptation, security-scoped bookmarks).
* Multi-language tokenization improvements.

---

## 32) Ready-to-Use Checklist

### Development Setup
* [ ] Initialize Electron + TypeScript project
* [ ] Add dependencies: `electron`, `typescript`, `@xenova/transformers`, `vectordb`, `chokidar`, `pdfjs-dist`
* [ ] Configure Electron security settings
* [ ] Implement DI for embeddings (`setEmbedImpl`) to allow mocking
* [ ] Set up project structure as outlined

### Testing Setup
* [ ] Add `vitest`, `playwright`, `@playwright/test`, `nyc` (via vitest coverage)
* [ ] Add `no-network` helper and install in Vitest setup
* [ ] Create `fixtures` PDFs/TXT/MD and goldens
* [ ] Write unit tests listed in §17
* [ ] Wire integration suite with temp LanceDB dir
* [ ] Add E2E harness with folder picker bypass
* [ ] Configure GitHub Actions on macOS 13+
* [ ] Set coverage thresholds and enforce

### Distribution
* [ ] Configure `electron-builder` for DMG
* [ ] Set up hardened runtime entitlements
* [ ] Prepare notarization credentials
* [ ] Bundle models in `extraResources`

---

**End of Complete Specification**

This document is ready to hand to Claude Code (or similar) to scaffold the project, implement all components, and ensure thorough testing with privacy guarantees.