import { context } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function watch(entry, outfile) {
  const ctx = await context({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: [
      'electron', 
      '@lancedb/lancedb', 
      'apache-arrow', 
      'pdf-parse',
      '@xenova/transformers',
      'onnxruntime-node',
      'sharp',
      'mammoth',
      'textract',
      'fsevents'
    ],
    sourcemap: true,
    target: 'node18',
    logLevel: 'info',
  });
  
  await ctx.watch();
  console.log(`Watching ${entry}...`);
}

async function main() {
  await Promise.all([
    watch(
      path.join(__dirname, 'app/electron/main.ts'),
      path.join(__dirname, 'dist/main.cjs')
    ),
    watch(
      path.join(__dirname, 'app/electron/preload.ts'),
      path.join(__dirname, 'dist/preload.cjs')
    ),
    watch(
      path.join(__dirname, 'app/electron/worker/index.ts'),
      path.join(__dirname, 'dist/worker.cjs')
    ),
  ]);
  
  console.log('Build watchers started. Press Ctrl+C to stop.');
}

main().catch(console.error);