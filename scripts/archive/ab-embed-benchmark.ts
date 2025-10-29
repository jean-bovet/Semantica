// scripts/ab-embed-benchmark.ts
// ⚠️ LEGACY: This script is for the old Transformers.js/ONNX architecture.
// The current implementation uses a Python sidecar with sentence-transformers.
// Kept for historical reference on memory testing methodology.
/*
  A/B memory harness for @xenova/transformers.
  - Detects backend: WASM (no onnxruntime-node installed) vs Node (if installed).
  - Embeds batches repeatedly, logs memory each iteration, computes RSS slope (MB/iter).
  - Requires: node --expose-gc (so we can call global.gc()).
*/

import path from "node:path";
import fs from "node:fs";
import { performance } from "node:perf_hooks";

// Lazy import after we configure env vars
type Pipeline = any;

type Args = {
  modelsRoot: string;
  model: string;          // e.g. "intfloat/e5-small" (folder under modelsRoot)
  iters: number;          // iterations
  batch: number;          // texts per batch
  textLen: number;        // chars per text
  reinit: boolean;        // recreate pipeline each iteration
  csv?: string;           // optional CSV output path
  gcEvery: number;        // call global.gc every N iters (0 disables)
};

function parseArgs(): Args {
  const get = (k: string, d?: string) =>
    (process.argv.find(a => a.startsWith(`--${k}=`))?.split("=")[1] ?? d) as string | undefined;

  return {
    modelsRoot: get("modelsRoot", "./resources/models")!,
    model: get("model", "intfloat/e5-small")!,
    iters: parseInt(get("iters", "200")!, 10),
    batch: parseInt(get("batch", "16")!, 10),
    textLen: parseInt(get("textLen", "256")!, 10),
    reinit: (get("reinit", "false")! === "true"),
    csv: get("csv"),
    gcEvery: parseInt(get("gcEvery", "1")!, 10),
  };
}

function isNodeBackendInstalled(): boolean {
  try { require.resolve("onnxruntime-node"); return true; } catch { return false; }
}

function mem() {
  const u = process.memoryUsage();
  return {
    rssMB: Math.round(u.rss / 1024 / 1024),
    heapUsedMB: Math.round(u.heapUsed / 1024 / 1024),
    externalMB: Math.round(u.external / 1024 / 1024),
    arrayBuffersMB: Math.round((u as any).arrayBuffers / 1024 / 1024) || 0,
  };
}

function makeBatch(n: number, len: number): string[] {
  // Deterministic pseudo-random-ish texts
  const base = "the quick brown fox jumps over the lazy dog ";
  const s = base.repeat(Math.ceil(len / base.length)).slice(0, len);
  const arr: string[] = [];
  for (let i = 0; i < n; i++) arr.push(`${s} [${i}]`);
  return arr;
}

function regressSlope(xs: number[], ys: number[]) {
  // simple linear regression slope (MB per iter)
  const n = xs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i]*xs[i]; sxy += xs[i]*ys[i]; }
  const denom = (n * sxx - sx * sx) || 1;
  return (n * sxy - sx * sy) / denom;
}

async function main() {
  const args = parseArgs();

  // ----- Backend detection & env knobs (offline) -----
  const nodeBackend = isNodeBackendInstalled();
  const backend = nodeBackend ? "node(onnxruntime-node)" : "wasm";
  console.log(`Backend: ${backend}`);

  // Configure transformers.js **offline**
  const { env, pipeline } = await import("@xenova/transformers");
  env.allowRemoteModels = false;
  env.localModelPath = path.resolve(args.modelsRoot);

  // Optional: tame WASM threads (only applies if WASM backend)
  (env as any).backends ??= {};
  (env as any).backends.onnx ??= {};
  (env as any).backends.onnx.wasm ??= {};
  (env as any).backends.onnx.wasm.numThreads = 2;
  (env as any).backends.onnx.wasm.proxy = true;

  // Sanity: model directory must exist under modelsRoot
  const expected = path.join(args.modelsRoot, args.model);
  if (!fs.existsSync(expected)) {
    console.error(`Model folder not found: ${expected}
- Place your local model under modelsRoot.
- Example: ${args.modelsRoot}/intfloat/e5-small`);
    process.exit(1);
  }

  // ----- Warmup -----
  let embedder: Pipeline | null = await pipeline("feature-extraction", args.model, { quantized: true });
  let out = await embedder(await makeBatch(2, 64), { pooling: "mean", normalize: true });
  if (typeof out?.dispose === "function") out.dispose();
  out = null;

  const xs: number[] = [];
  const rss: number[] = [];
  const ext: number[] = [];
  const tickStart = performance.now();

  // ----- Main loop -----
  const batch = makeBatch(args.batch, args.textLen);

  for (let i = 1; i <= args.iters; i++) {
    if (args.reinit) {
      if (embedder && typeof (embedder as any).dispose === "function") (embedder as any).dispose();
      embedder = await pipeline("feature-extraction", args.model, { quantized: true });
    }

    let output: any;
    const t0 = performance.now();
    try {
      output = await embedder!(batch, { pooling: "mean", normalize: true });
      // Touch the data to ensure computation actually happens
      const dim = output.dims?.[output.dims.length - 1] ?? 384;
      if (!dim || !output.data || output.data.length % dim !== 0) {
        throw new Error("Unexpected embedding shape");
      }
    } finally {
      if (output && typeof output.dispose === "function") output.dispose();
      output = null;
    }

    if (global.gc && args.gcEvery > 0 && i % args.gcEvery === 0) global.gc();

    const m = mem();
    const t1 = performance.now();
    console.log(
      `iter=${i} time=${(t1 - t0).toFixed(1)}ms | rss=${m.rssMB}MB heap=${m.heapUsedMB}MB ext=${m.externalMB}MB ab=${m.arrayBuffersMB}MB`
    );

    xs.push(i);
    rss.push(m.rssMB);
    ext.push(m.externalMB);
  }

  const rssSlope = regressSlope(xs, rss);
  const extSlope = regressSlope(xs, ext);
  const elapsed = ((performance.now() - tickStart) / 1000).toFixed(1);

  console.log(`\n=== SUMMARY ===
backend=${backend}
iters=${args.iters} batch=${args.batch} textLen=${args.textLen} reinit=${args.reinit}
rssSlopeMBperIter=${rssSlope.toFixed(3)}
extSlopeMBperIter=${extSlope.toFixed(3)}
elapsed=${elapsed}s
`);

  if (args.csv) {
    fs.writeFileSync(
      args.csv,
      ["iter,rssMB,externalMB", ...xs.map((x, i) => `${x},${rss[i]},${ext[i]}`)].join("\n"),
      "utf8"
    );
    console.log(`CSV written: ${path.resolve(args.csv)}`);
  }

  // Cleanup
  if (embedder && typeof (embedder as any).dispose === "function") (embedder as any).dispose();
}

main().catch((e) => { console.error(e); process.exit(1); });