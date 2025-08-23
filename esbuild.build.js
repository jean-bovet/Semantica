import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function buildFile(entry, outfile) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: [
      'electron', 
      '@lancedb/lancedb', 
      'apache-arrow', 
      'pdfjs-dist',
      '@xenova/transformers',
      'onnxruntime-node',
      'sharp',
      'mammoth',
      'textract',
      'fsevents'
    ],
    sourcemap: false,
    target: 'node18',
    minify: true,
    logLevel: 'info',
  });
  
  console.log(`Built ${outfile}`);
}

async function main() {
  await Promise.all([
    buildFile(
      path.join(__dirname, 'app/electron/main.ts'),
      path.join(__dirname, 'dist/main.cjs')
    ),
    buildFile(
      path.join(__dirname, 'app/electron/preload.ts'),
      path.join(__dirname, 'dist/preload.cjs')
    ),
    buildFile(
      path.join(__dirname, 'app/electron/worker/index.ts'),
      path.join(__dirname, 'dist/worker.cjs')
    ),
  ]);
  
  console.log('Production build complete.');
}

main().catch(console.error);