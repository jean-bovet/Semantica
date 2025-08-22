# Offline Mac Search App — Technical Spec (Electron + TypeScript + LanceDB)

**Goal:** Ship a notarized macOS app that indexes user-selected folders, creates local embeddings on-device, and serves fast semantic search—**no data leaves the device**.

**Audience:** You (dev) + AI coding assistants (Claude Code).
**Status:** Implementation-ready specification.
**Privacy:** 100% offline. No telemetry by default.

---

## 1) Product Scope

### 1.1 Core Features (MVP)

* Folder picker (multiple roots).
* Incremental indexer with file watching (PDF, TXT, MD).
* Chunking (heading/sentence-aware heuristic), 300–800 tokens, overlap \~50.
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

| Column   | Type        | Notes                                |     |    |                |
| -------- | ----------- | ------------------------------------ | --- | -- | -------------- |
| `id`     | TEXT (PK)   | `sha1(path:page:offset)`             |     |    |                |
| `path`   | TEXT        | absolute path                        |     |    |                |
| `mtime`  | FLOAT64     | file modified time (ms)              |     |    |                |
| `page`   | INT         | page number (PDF) or 0               |     |    |                |
| `offset` | INT         | byte/char offset for snippet rebuild |     |    |                |
| `text`   | TEXT        | chunked text                         |     |    |                |
| `vector` | VECTOR(384) | normalized embedding                 |     |    |                |
| `type`   | TEXT        | \`pdf                                | txt | md | …\` (optional) |
| `title`  | TEXT        | filename or doc title (optional)     |     |    |                |

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
* Target first-index throughput: \~200–600 chunks/min on typical laptop CPU (varies by model).

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

export async function embed(texts: string[]): Promise<number[][]> {
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
* **Result cards**: snippet, page #, file title, “Open” buttons.
* **Indexing status**: queued/processing/done counts; pause/resume; last error.
* **Settings**:

  * Folders + include/exclude globs
  * CPU throttle (Low/Med/High)
  * Model selection (E5-small default)
  * Network: **locked to “Disabled”** (display-only)

---

## 14) Testing Plan

* Unit tests: chunker, ID determinism, embedding shape/normalization.
* Integration: parse→chunk→embed→upsert→search on a fixture corpus (10 PDFs, 10 MD, 10 TXT).
* Perf: time to index, RAM peak, query latency p50/p95.
* Recovery: kill process mid-index; ensure resumable and no corruption.
* Privacy smoke-test: intercept `http(s)` in Node—assert zero outbound requests during index/search.

---

## 15) Risks & Mitigations

* **PDF text quality** (pdf.js quirks) → allow switching to alternative parser later; consider PDFKit native plugin if needed.
* **Embedding speed** → keep quantized model; allow batch size tuning.
* **Large corpora** → paginate indexing; show ETA; allow per-folder rules.
* **Binary scans** → optional OCR toggle later (tesseract.js).
* **Model packaging size** → ship one small model by default; add “Advanced: import local model” UI later.

---

## 16) Milestones

1. **Week 1**: Project scaffold, Electron security, LanceDB init, local model load, manual “index file” command.
2. **Week 2**: Folder picker, watcher, index queue, PDF/TXT/MD parsers, search UI.
3. **Week 3**: Progress UI, pause/resume, result grouping, open-in-Preview/Finder, notarized DMG.

---

## 17) Commands & Scripts

* `dev`: run Electron with live reload.
* `build`: type-check + bundle (main/preload/renderer).
* `dist`: `electron-builder` DMG.
* `postinstall`: run `electron-rebuild` if native deps added (not required for pure JS).

Example `package.json` scripts:

```json
{
  "scripts": {
    "dev": "concurrently \"vite --config renderer.vite.ts\" \"ts-node esbuild.main.ts --watch\" \"wait-on http://localhost:5173 && electron .\"",
    "build": "tsc -b",
    "dist": "electron-builder",
    "postinstall": "electron-builder install-app-deps"
  }
}
```

---

## 18) Done Criteria (MVP)

* Indexes selected folders; re-indexes on change; no crashes on large PDFs.
* Search returns relevant hits in <200 ms for \~50k chunks on M-series CPU.
* No outbound network traffic during indexing/search (verified).
* Notarized DMG installs and runs on macOS 13+ (Intel optional).
* Clear privacy statement: all local, no telemetry.

---

## 19) Future Enhancements (Post-MVP)

* OCR (tesseract.js), toggle per folder.
* Cross-encoder re-ranker (local ONNX) for top-20.
* Rich previews (page image thumbnails).
* Encrypted store option (switch to SQLite+SQLCipher or encrypt LanceDB directory at OS level).
* App Store build (sandbox adaptation, security-scoped bookmarks).
* Multi-language tokenization improvements.

---

**End of Spec**
This document is ready to hand to Claude Code (or similar) to scaffold the project, generate the code skeletons above, and wire up the IPC + UI.
