# Testing Strategy — Offline Mac Search App (Electron + TS + LanceDB)

**Goal:** High confidence that indexing, embeddings, search, and UI remain correct, private (no network), and performant.
**Test stack:** Vitest (unit/integration), Playwright (E2E), NYC/istanbul (coverage), GitHub Actions (CI on macOS).

---

## 1) Test Pyramid

* **Unit (≈70%)**
  Pure functions/modules: chunker, PDF/text parsers (logic), ID/digest, embedding adapter (mocked), LanceDB wrapper (mocked), IPC validators.
* **Integration (≈25%)**
  Real LanceDB on a temp dir + real worker thread + mocked embeddings; parse→chunk→embed→upsert→search on a small fixture corpus.
* **End-to-End (≈5%)**
  Boot Electron app, add a fixture folder, wait for index, run a search through the UI; assert results & privacy (no network).

---

## 2) Testing Principles

* **Determinism:** seeded RNG for any randomization; stable fixture corpus; fixed model-dim (384).
* **Isolation:** temp directories for DB and caches; no writes outside test sandboxes.
* **No Network:** hard fail any outbound HTTP(S).
* **Fast by Default:** heavy tests (OCR, big corpora) behind `it.skipIfCI` or nightly workflow.
* **Golden Files:** for parser outputs/snippets to detect regressions.
* **Property-based checks:** for chunker (boundaries, overlaps, unicode).

---

## 3) Test Structure

```
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
```

---

## 4) Unit Tests (Vitest)

### 4.1 Chunker

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

### 4.2 ID/Digest

**What:** deterministic SHA-1 over `(path:page:offset)`; collision sanity.
**Checks:** equal inputs → equal IDs; different offsets → different IDs.

### 4.3 Parsers (PDF/Text)

**What:** pdfjs output normalization; removes excessive whitespace; preserves order.
**Technique:** compare against **golden JSON** (page→text) for small PDFs.

### 4.4 Embeddings Adapter

**What:** adapter returns vectors with correct shape and normalization.
**Approach:** **mock** model to return deterministic vectors for given inputs (e.g., seeded hash to 384-dim unit vectors).
**Checks:** cosine(vec, vec)=1; cosine(a,b) in \[-1,1]; output length matches inputs.

### 4.5 LanceDB Wrapper

**What:** table schema creation, upsert-by-PK, simple query flow.
**Approach:** replace LanceDB with a **fake in-memory adapter** in unit tests (or spy around its API).

### 4.6 IPC Contract

**What:** runtime validation of payloads (zod or custom).
**Checks:** bad inputs rejected; good inputs pass.

---

## 5) Integration Tests (Vitest)

**Environment:** real LanceDB on a temp dir; real worker thread; **mocked embeddings** (fast, deterministic).

### 5.1 Parse→Chunk→Embed→Upsert→Search

* Feed 2 PDFs + 2 MD + 2 TXT fixtures.
* Wait for worker to drain queue.
* Query terms that should hit known chunks.
* Assert top-1/3 hits contain expected file/path/page and snippet.

### 5.2 Re-index on Change

* Index a file.
* Modify its content; ensure chunk IDs change appropriately and stale rows are replaced.
* Assert query finds *new* content; *old* content gone.

### 5.3 Deletion (unlink)

* Remove a file; ensure its rows are removed (implement removal API first).
* Assert search no longer returns that path.

### 5.4 Concurrency/Backpressure

* Enqueue 50 files (small fixtures).
* Ensure progress increases; no deadlocks; memory stays under threshold (track RSS).

### 5.5 Crash Recovery

* Kill worker mid-index (simulate crash).
* Restart pipeline; ensure idempotent upserts and no corruption.

---

## 6) End-to-End (Playwright)

**Scenario:**

* Launch Electron (headless off); choose fixture folder via a stubbed folder picker or injected setting.
* Wait for “Indexing complete” (UI indicator from IPC progress).
* Type a known query; verify UI list shows expected file/page/snippet; test “Open in Finder” is called with correct path (stub shell open).

**Privacy:**

* Load a **no-network hook** (see below) that fails any HTTP(S) request during E2E; run a search and observe zero network attempts.

---

## 7) Privacy: Block All Network

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

## 8) Mocks & Fixtures

### 8.1 Mock Embeddings

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

In app code, allow DI:

```ts
// embeddings/local.ts
export type EmbedFn = (texts: string[]) => Promise<number[][]>;
let embedImpl: EmbedFn | null = null;
export function setEmbedImpl(fn: EmbedFn) { embedImpl = fn; }
export async function embed(texts: string[]) {
  if (!embedImpl) throw new Error('embedImpl not set in tests or production init');
  return embedImpl(texts);
}
```

Production boot sets `embedImpl` to transformers.js; tests set it to `mockEmbed`.

### 8.2 Fixtures

* **PDFs:** tiny synthetic PDFs with known phrases: “the quick brown fox…”. Include edge cases: ligatures, columns, long lines.
* **Texts/MD:** include headings (`#`, `##`) to test chunking around structure.
* **Goldens:** `fixtures/goldens/<file>.json` storing expected page texts and/or chunk arrays.

---

## 9) Performance Tests (optional in CI, nightly preferred)

* **Index throughput:** N chunks/min on M-series (baseline, e.g., 400±20%).
* **Query latency:** p50/p95 for k=10 over 50k chunks (with mocked embeddings).
* Fail build if **regression > 30%** from baseline (stored in a JSON and updated intentionally with review).

---

## 10) Coverage

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

## 11) CI (GitHub Actions) — macOS Runner

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

**Scripts (package.json):**

```json
{
  "scripts": {
    "test": "vitest",
    "test:ci": "vitest --run --reporter=dot",
    "test:e2e": "playwright test",
    "coverage": "vitest --run --coverage"
  }
}
```

Playwright needs its deps installed once:

```
npx playwright install --with-deps
```

(Do this in a setup step or pre-cache.)

---

## 12) Electron E2E Harness (Playwright)

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

## 13) Reliability Scenarios

* **Paused during embed batch** → resume continues without duplicate upserts.
* **Partial file write** (simulate temp writes) → parser rejects until stable `mtime`.
* **Locked file** → retry policy with exponential backoff, logs recorded.
* **DB lock** (rare with LanceDB) → retry or backoff with warning.

Each scenario should have an integration test.

---

## 14) Logging & Assertion Aids

* Minimal structured logs (JSON) in tests; attach to CI artifacts on failure.
* On assertion failure, dump: last N pipeline events, queue sizes, memory usage (RSS), and offending file path.

---

## 15) What to Gate on PRs

* All unit+integration tests green.
* Coverage thresholds met.
* E2E basic path green.
* No network test passes.
* Lint/typecheck pass.

---

## 16) Local Developer Commands

```
npm run test         # watch mode
npm run test:ci      # run once (used in CI)
npm run test:e2e     # Playwright E2E
npm run coverage     # coverage report
```

---

## 17) Nightly (Optional)

* Run heavy corpus perf tests.
* OCR tests (if/when added).
* Cross-encoder re-rank tests (if enabled later).

---

### Ready-to-Use Checklist

* [ ] Add `vitest`, `playwright`, `@playwright/test`, `nyc` (via vitest coverage).
* [ ] Implement DI for embeddings (`setEmbedImpl`) to allow mocking.
* [ ] Add `no-network` helper and install in Vitest setup.
* [ ] Create `fixtures` PDFs/TXT/MD and goldens.
* [ ] Write unit tests listed in §4.
* [ ] Wire integration suite with temp LanceDB dir.
* [ ] Add E2E harness with folder picker bypass.
* [ ] Configure GitHub Actions on macOS 13+.
* [ ] Set coverage thresholds and enforce.

---

**Outcome:** A fast, deterministic, privacy-enforcing test suite that guards the core contract (parse → chunk → embed → index → search) and prevents regressions as you iterate.
