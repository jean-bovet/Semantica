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
      'onnxruntime-node',
      'sharp',
      'fsevents',
      '@xenova/transformers',
      'chokidar',
      'pdf-parse',
      'mammoth',
      'word-extractor'
    ],
    sourcemap: false,
    target: 'node18',
    minify: true,
    logLevel: 'info',
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  });
  
  console.log(`Built ${outfile}`);
}

async function main() {
  await Promise.all([
    buildFile(
      path.join(__dirname, 'src/main/main.ts'),
      path.join(__dirname, 'dist/main.cjs')
    ),
    buildFile(
      path.join(__dirname, 'src/main/preload.ts'),
      path.join(__dirname, 'dist/preload.cjs')
    ),
    buildFile(
      path.join(__dirname, 'src/main/worker/index.ts'),
      path.join(__dirname, 'dist/worker.cjs')
    ),
  ]);

  console.log('Production build complete.');
}

main().catch(console.error);