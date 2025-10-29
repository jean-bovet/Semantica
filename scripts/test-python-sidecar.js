#!/usr/bin/env node

/**
 * Test script for Python embedding sidecar with failed batches and performance testing
 *
 * Usage:
 *   node scripts/test-python-sidecar.js ~/Desktop/failed-batch-*.json
 *   node scripts/test-python-sidecar.js --all    # Test all failed batches on Desktop
 *   node scripts/test-python-sidecar.js --perf   # Run performance benchmarks
 *   node scripts/test-python-sidecar.js --help
 *
 * This script:
 * 1. Loads failed batch JSON file(s) from Desktop
 * 2. Tests the full batch with Python sidecar
 * 3. Tests each text individually
 * 4. Tests sub-batches to find problematic text
 * 5. Compares results with Ollama (optional)
 * 6. Runs comprehensive performance benchmarks (--perf mode)
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { glob } = require('glob');

// Configuration
const SIDECAR_HOST = process.env.EMBED_HOST || '127.0.0.1';
const SIDECAR_PORT = Number(process.env.EMBED_PORT || 8421);
const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'nomic-embed-text';
const TIMEOUT_MS = 30000; // 30 seconds

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(70));
  log(title, 'cyan');
  console.log('='.repeat(70));
}

/**
 * Make HTTP request to sidecar
 */
async function httpRequest(path, method, body) {
  const bodyStr = body ? JSON.stringify(body) : '';
  const options = {
    host: SIDECAR_HOST,
    port: SIDECAR_PORT,
    path,
    method,
    headers: {
      'content-type': 'application/json',
      'content-length': bodyStr ? Buffer.byteLength(bodyStr) : 0
    },
    timeout: TIMEOUT_MS
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ success: true, data: JSON.parse(text), status: res.statusCode });
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${text}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${text}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Embed texts using Python sidecar
 */
async function embedWithSidecar(texts, batchSize = 16, normalize = true) {
  try {
    const result = await httpRequest('/embed', 'POST', {
      texts,
      normalize,
      pooling: 'mean',
      batch_size: batchSize
    });

    return {
      success: true,
      vectors: result.data.vectors,
      count: result.data.vectors.length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Embed texts using Ollama (for comparison)
 */
async function embedWithOllama(texts, model = OLLAMA_MODEL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: texts,
        keep_alive: '2m'
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const responseText = await response.text();

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: responseText
      };
    }

    const data = JSON.parse(responseText);
    return {
      success: true,
      embeddings: data.embeddings,
      count: data.embeddings.length
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Check sidecar health
 */
async function checkSidecarHealth() {
  logSection('Python Sidecar Health Check');

  try {
    // Check /health endpoint
    const healthResult = await httpRequest('/health', 'GET');
    if (healthResult.success && healthResult.data.status === 'ok') {
      log('✅ Sidecar is running', 'green');
    } else {
      log('❌ Sidecar health check failed', 'red');
      return false;
    }

    // Check /info endpoint
    const infoResult = await httpRequest('/info', 'GET');
    if (infoResult.success) {
      log('✅ Sidecar info retrieved', 'green');
      console.log(`   Model: ${infoResult.data.model_id}`);
      console.log(`   Dimensions: ${infoResult.data.dim}`);
      console.log(`   Device: ${infoResult.data.device}`);
    }

    // Test simple embed
    console.log('\nTesting simple embed request...');
    const testResult = await embedWithSidecar(['hello world']);
    if (testResult.success) {
      log('✅ Simple embed request works', 'green');
      console.log(`   Generated ${testResult.count} embeddings`);
      console.log(`   Vector dim: ${testResult.vectors[0].length}`);
      return true;
    } else {
      log(`❌ Simple embed failed: ${testResult.error}`, 'red');
      return false;
    }
  } catch (error) {
    log(`❌ Sidecar health check failed: ${error.message}`, 'red');
    log(`   Make sure sidecar is running on ${SIDECAR_HOST}:${SIDECAR_PORT}`, 'yellow');
    log(`   Start with: cd embedding_sidecar && python embed_server.py`, 'yellow');
    return false;
  }
}

/**
 * Test the full batch
 */
async function testFullBatch(batch, compareWithOllama = false) {
  logSection(`Test 1: Full Batch (${batch.chunkCount} texts)`);

  console.log(`Chars: ${batch.totalChars}`);
  console.log(`Est. Tokens: ${batch.estimatedTokens}`);
  console.log(`Original Error (Ollama): ${batch.error}`);
  console.log('\n🐍 Sending request to Python sidecar...');

  const startTime = Date.now();
  const result = await embedWithSidecar(batch.texts);
  const duration = Date.now() - startTime;

  if (result.success) {
    log(`✅ SUCCESS: Full batch processed in ${duration}ms!`, 'green');
    console.log(`Generated ${result.count} embeddings`);
    console.log(`Vector dim: ${result.vectors[0].length}`);
    console.log(`Throughput: ${(batch.chunkCount / (duration / 1000)).toFixed(2)} texts/sec`);

    // Compare with Ollama if requested
    if (compareWithOllama) {
      console.log('\n🦙 Comparing with Ollama...');
      const ollamaStart = Date.now();
      const ollamaResult = await embedWithOllama(batch.texts);
      const ollamaDuration = Date.now() - ollamaStart;

      if (ollamaResult.success) {
        log(`✅ Ollama also succeeded in ${ollamaDuration}ms`, 'green');
        console.log(`   Speedup: ${(ollamaDuration / duration).toFixed(2)}x ${duration < ollamaDuration ? 'faster' : 'slower'}`);
      } else {
        log(`❌ Ollama failed: ${ollamaResult.error}`, 'red');
        log('   → Python sidecar handles this batch better!', 'green');
      }
    }

    return { success: true, duration, failedTexts: [] };
  } else {
    log(`❌ FAILED: ${result.error}`, 'red');
    return { success: false, duration, failedTexts: batch.texts };
  }
}

/**
 * Test each text individually
 */
async function testIndividualTexts(texts) {
  logSection(`Test 2: Individual Texts (${texts.length} texts)`);

  const results = [];
  const failed = [];
  let totalDuration = 0;

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    process.stdout.write(`Testing text ${i + 1}/${texts.length} (${text.length} chars)... `);

    const startTime = Date.now();
    const result = await embedWithSidecar([text]);
    const duration = Date.now() - startTime;
    totalDuration += duration;

    if (result.success) {
      log(`✅ ${duration}ms`, 'green');
      results.push({ index: i, success: true, duration });
    } else {
      log(`❌ ${result.error}`, 'red');
      results.push({ index: i, success: false, error: result.error, duration });
      failed.push({ index: i, text: text, error: result.error });
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`\n${successCount}/${texts.length} texts succeeded`);
  console.log(`Total time: ${totalDuration}ms (avg ${(totalDuration / texts.length).toFixed(1)}ms per text)`);

  if (failed.length > 0) {
    log(`\n⚠️  Failed texts:`, 'yellow');
    failed.forEach(({ index, text, error }) => {
      console.log(`  [${index}] ${text.substring(0, 100)}...`);
      console.log(`      Error: ${error}`);
    });
  }

  return { results, failed, totalDuration };
}

/**
 * Binary search to find problematic combination
 */
async function testSubBatches(texts) {
  logSection('Test 3: Sub-batches (Binary Search)');

  if (texts.length <= 1) {
    log('Only 1 text, skipping sub-batch tests', 'yellow');
    return;
  }

  // Try pairs
  log('\nTesting pairs:', 'cyan');
  for (let i = 0; i < Math.min(texts.length - 1, 10); i++) { // Limit to first 10 pairs
    process.stdout.write(`  Pair [${i}, ${i+1}]... `);
    const result = await embedWithSidecar([texts[i], texts[i + 1]]);

    if (result.success) {
      log('✅', 'green');
    } else {
      log(`❌ ${result.error}`, 'red');
      console.log(`    Problematic pair found: indices ${i} and ${i+1}`);
    }
  }

  // Try first half vs second half
  if (texts.length >= 4) {
    log('\nTesting halves:', 'cyan');
    const mid = Math.floor(texts.length / 2);

    process.stdout.write(`  First half (0-${mid-1})... `);
    const firstHalf = await embedWithSidecar(texts.slice(0, mid));
    log(firstHalf.success ? '✅' : `❌ ${firstHalf.error}`, firstHalf.success ? 'green' : 'red');

    process.stdout.write(`  Second half (${mid}-${texts.length-1})... `);
    const secondHalf = await embedWithSidecar(texts.slice(mid));
    log(secondHalf.success ? '✅' : `❌ ${secondHalf.error}`, secondHalf.success ? 'green' : 'red');
  }

  // Try different batch sizes
  log('\nTesting different batch sizes:', 'cyan');
  for (const batchSize of [4, 8, 16]) {
    if (texts.length >= batchSize) {
      process.stdout.write(`  Batch size ${batchSize}... `);
      const result = await embedWithSidecar(texts.slice(0, batchSize), batchSize);
      log(result.success ? '✅' : `❌ ${result.error}`, result.success ? 'green' : 'red');
    }
  }
}

/**
 * Analyze batch content
 */
function analyzeBatch(batch) {
  logSection('Batch Analysis');

  console.log(`Timestamp: ${batch.timestamp}`);
  console.log(`Chunk Count: ${batch.chunkCount}`);
  console.log(`Total Characters: ${batch.totalChars.toLocaleString()}`);
  console.log(`Estimated Tokens: ${batch.estimatedTokens.toLocaleString()}`);
  console.log(`Text Lengths: [${batch.textLengths.join(', ')}]`);
  console.log(`Avg Length: ${Math.round(batch.totalChars / batch.chunkCount)} chars`);
  console.log(`Max Length: ${Math.max(...batch.textLengths)} chars`);
  console.log(`Min Length: ${Math.min(...batch.textLengths)} chars`);

  // Character analysis
  const totalChars = batch.texts.reduce((sum, t) => sum + t.length, 0);
  const nonAscii = batch.texts.reduce((sum, t) => {
    return sum + (t.match(/[^\x00-\x7F]/g) || []).length;
  }, 0);
  const pctNonAscii = ((nonAscii / totalChars) * 100).toFixed(1);

  console.log(`\nNon-ASCII chars: ${nonAscii} (${pctNonAscii}%)`);

  // Show previews
  console.log(`\nFirst text preview (${batch.texts[0].length} chars):`);
  console.log(`  "${batch.texts[0].substring(0, 150).replace(/\n/g, '\\n')}..."`);

  if (batch.texts.length > 1) {
    const lastText = batch.texts[batch.texts.length - 1];
    console.log(`\nLast text preview (${lastText.length} chars):`);
    console.log(`  "...${lastText.substring(Math.max(0, lastText.length - 150)).replace(/\n/g, '\\n')}"`);
  }
}

// ============================================================================
// PERFORMANCE TESTING FUNCTIONS
// ============================================================================

/**
 * Generate test text of specific size
 */
function generateTestText(targetSize) {
  const lorem = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. `;

  let text = '';
  while (text.length < targetSize) {
    text += lorem;
  }
  return text.substring(0, targetSize);
}

/**
 * Calculate statistics from array of numbers
 */
function calculateStats(numbers) {
  if (numbers.length === 0) return {};

  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = numbers.reduce((a, b) => a + b, 0);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / numbers.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p50: sorted[Math.floor(sorted.length * 0.50)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)]
  };
}

/**
 * Run serial benchmark for specific configuration
 */
async function runSerialBenchmark(textSize, batchSize, iterations) {
  const texts = Array(batchSize).fill(null).map(() => generateTestText(textSize));
  const durations = [];
  let successCount = 0;

  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();
    const result = await embedWithSidecar(texts, batchSize);
    const duration = Date.now() - startTime;

    durations.push(duration);
    if (result.success) successCount++;
  }

  const stats = calculateStats(durations);
  const totalChars = textSize * batchSize * iterations;
  const totalTime = durations.reduce((a, b) => a + b, 0);

  return {
    textSize,
    batchSize,
    iterations,
    threads: 1,

    // Timing stats
    ...stats,

    // Throughput
    textsPerSec: (batchSize * iterations) / (totalTime / 1000),
    charsPerSec: totalChars / (totalTime / 1000),
    batchesPerSec: iterations / (totalTime / 1000),

    // Success rate
    successCount,
    successRate: (successCount / iterations) * 100
  };
}

/**
 * Run concurrent benchmark with multiple threads
 */
async function runConcurrentBenchmark(textSize, batchSize, threads, iterations) {
  const texts = Array(batchSize).fill(null).map(() => generateTestText(textSize));

  const startTime = Date.now();
  const promises = [];

  // Launch concurrent threads
  for (let t = 0; t < threads; t++) {
    const threadPromises = [];
    for (let i = 0; i < iterations; i++) {
      threadPromises.push(embedWithSidecar(texts, batchSize));
    }
    promises.push(Promise.all(threadPromises));
  }

  const results = await Promise.all(promises);
  const totalDuration = Date.now() - startTime;

  // Calculate per-thread statistics
  const threadStats = results.map(threadResults => {
    const successCount = threadResults.filter(r => r.success).length;
    return { successCount, iterations };
  });

  const totalRequests = threads * iterations;
  const successfulRequests = threadStats.reduce((sum, t) => sum + t.successCount, 0);
  const totalTexts = batchSize * threads * iterations;
  const totalChars = textSize * totalTexts;

  return {
    textSize,
    batchSize,
    iterations,
    threads,

    // Timing
    duration: totalDuration,
    avgLatency: totalDuration / totalRequests,

    // Throughput (aggregate across all threads)
    textsPerSec: totalTexts / (totalDuration / 1000),
    charsPerSec: totalChars / (totalDuration / 1000),
    perThreadTextsPerSec: totalTexts / threads / (totalDuration / 1000),

    // Success rate
    totalRequests,
    successfulRequests,
    successRate: (successfulRequests / totalRequests) * 100,

    // Scaling
    speedup: (totalTexts / (totalDuration / 1000)) / ((batchSize * iterations) / (totalDuration / threads / 1000))
  };
}

/**
 * Display performance results in table format
 */
function displaySerialResults(results) {
  logSection('SERIAL PERFORMANCE TESTS');

  // Group by text size
  const byTextSize = {};
  results.forEach(r => {
    if (!byTextSize[r.textSize]) byTextSize[r.textSize] = [];
    byTextSize[r.textSize].push(r);
  });

  Object.entries(byTextSize).forEach(([textSize, sizeResults]) => {
    console.log(`\nText Size: ${textSize} chars (~${Math.round(textSize / 2.5)} tokens)`);
    console.log('┌──────────┬──────────┬────────────┬──────────────┬───────────────┐');
    console.log('│ Batch    │ Latency  │ p95        │ Throughput   │ Success Rate  │');
    console.log('│ Size     │ (avg ms) │ (ms)       │ (texts/sec)  │               │');
    console.log('├──────────┼──────────┼────────────┼──────────────┼───────────────┤');

    sizeResults.forEach(r => {
      console.log(`│ ${String(r.batchSize).padEnd(8)} │ ${String(Math.round(r.avg)).padEnd(8)} │ ${String(Math.round(r.p95)).padEnd(10)} │ ${r.textsPerSec.toFixed(1).padEnd(12)} │ ${r.successRate.toFixed(0).padEnd(13)}% │`);
    });

    console.log('└──────────┴──────────┴────────────┴──────────────┴───────────────┘');

    // Find optimal batch size
    const optimal = sizeResults.reduce((best, current) =>
      current.textsPerSec > best.textsPerSec ? current : best
    );
    log(`\nOptimal batch size: ${optimal.batchSize} (${optimal.textsPerSec.toFixed(1)} texts/sec)`, 'green');
  });
}

/**
 * Display concurrent results in table format
 */
function displayConcurrentResults(results) {
  logSection('CONCURRENT PERFORMANCE TESTS');

  // Group by configuration
  const byConfig = {};
  results.forEach(r => {
    const key = `${r.textSize}_${r.batchSize}`;
    if (!byConfig[key]) byConfig[key] = [];
    byConfig[key].push(r);
  });

  Object.entries(byConfig).forEach(([key, configResults]) => {
    const [textSize, batchSize] = key.split('_');
    console.log(`\nConfig: ${textSize} chars, ${batchSize} batch size`);
    console.log('┌──────────┬──────────────┬────────────┬──────────────┬─────────────┐');
    console.log('│ Threads  │ Aggregate    │ Per-Thread │ Speedup      │ Success %   │');
    console.log('│          │ (texts/sec)  │ (texts/sec)│              │             │');
    console.log('├──────────┼──────────────┼────────────┼──────────────┼─────────────┤');

    const baseline = configResults.find(r => r.threads === 1);
    configResults.forEach(r => {
      const speedup = baseline ? (r.textsPerSec / baseline.textsPerSec) : 1.0;
      const efficiency = (speedup / r.threads * 100).toFixed(0);
      console.log(`│ ${String(r.threads).padEnd(8)} │ ${r.textsPerSec.toFixed(1).padEnd(12)} │ ${r.perThreadTextsPerSec.toFixed(1).padEnd(10)} │ ${speedup.toFixed(2).padEnd(12)}x │ ${r.successRate.toFixed(0).padEnd(10)}% │`);
    });

    console.log('└──────────┴──────────────┴────────────┴──────────────┴─────────────┘');

    // Calculate scaling efficiency
    const maxThreads = Math.max(...configResults.map(r => r.threads));
    const maxResult = configResults.find(r => r.threads === maxThreads);
    if (maxResult && baseline) {
      const efficiency = ((maxResult.textsPerSec / baseline.textsPerSec) / maxThreads * 100).toFixed(0);
      log(`\nScaling efficiency: ${efficiency}% (${maxThreads} threads = ${(maxResult.textsPerSec / baseline.textsPerSec).toFixed(2)}x vs ideal ${maxThreads}.00x)`, 'cyan');
    }
  });
}

/**
 * Export results to CSV
 */
function exportCSV(results, filename) {
  const headers = ['test_type', 'text_size', 'batch_size', 'threads', 'iterations',
                   'avg_latency', 'p95_latency', 'texts_per_sec', 'chars_per_sec', 'success_rate'];

  const rows = results.map(r => [
    r.threads > 1 ? 'concurrent' : 'serial',
    r.textSize,
    r.batchSize,
    r.threads,
    r.iterations,
    r.avg || r.avgLatency,
    r.p95 || 'N/A',
    r.textsPerSec.toFixed(2),
    r.charsPerSec.toFixed(2),
    r.successRate.toFixed(2)
  ]);

  const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
  fs.writeFileSync(filename, csv);
  log(`\n✅ Results exported to: ${filename}`, 'green');
}

/**
 * Export results to JSON
 */
function exportJSON(results, filename) {
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));
  log(`\n✅ Results exported to: ${filename}`, 'green');
}

/**
 * Run comprehensive performance benchmark suite
 */
async function runPerformanceBenchmark(options = {}) {
  const {
    maxThreads = 5,
    maxSize = 10000,
    quick = false,
    compareOllama = false,
    exportCsv = null,
    exportJson = null
  } = options;

  logSection('PERFORMANCE BENCHMARK - Python Sidecar');

  // Get sidecar info
  const infoResult = await httpRequest('/info', 'GET');
  if (infoResult.success) {
    console.log(`Model: ${infoResult.data.model_id}`);
    console.log(`Dimensions: ${infoResult.data.dim}`);
    console.log(`Device: ${infoResult.data.device}`);
  }

  // Define test configurations
  const textSizes = quick ? [1000, 2000] : [500, 1000, 2000, 5000, Math.min(10000, maxSize)];
  const batchSizes = quick ? [10, 32] : [1, 5, 10, 20, 32, 64];
  const threadCounts = Array.from({length: maxThreads}, (_, i) => i + 1);
  const iterations = quick ? 5 : 10;

  console.log(`Iterations: ${iterations} per test`);
  console.log(`${quick ? 'Quick mode' : 'Full mode'}`);

  // Warm-up
  log('\nWarm-up: Running 5 requests to load model into memory...', 'yellow');
  for (let i = 0; i < 5; i++) {
    await embedWithSidecar([generateTestText(1000)]);
  }
  log('✅ Warm-up complete\n', 'green');

  const serialResults = [];
  const concurrentResults = [];

  // Serial tests
  logSection('Running Serial Tests');
  let testNum = 0;
  const totalSerialTests = textSizes.length * batchSizes.length;

  for (const textSize of textSizes) {
    for (const batchSize of batchSizes) {
      testNum++;
      process.stdout.write(`Test ${testNum}/${totalSerialTests}: ${textSize} chars, ${batchSize} batch... `);

      const result = await runSerialBenchmark(textSize, batchSize, iterations);
      serialResults.push(result);

      log(`✅ ${result.textsPerSec.toFixed(1)} texts/sec`, 'green');
    }
  }

  // Concurrent tests (selected configurations only)
  logSection('Running Concurrent Tests');
  const concurrentConfigs = quick
    ? [[1000, 32]]
    : [[1000, 32], [2000, 32], [5000, 16]];

  testNum = 0;
  const totalConcurrentTests = concurrentConfigs.length * threadCounts.length;

  for (const [textSize, batchSize] of concurrentConfigs) {
    for (const threads of threadCounts) {
      testNum++;
      process.stdout.write(`Test ${testNum}/${totalConcurrentTests}: ${textSize} chars, ${batchSize} batch, ${threads} threads... `);

      const result = await runConcurrentBenchmark(textSize, batchSize, threads, iterations);
      concurrentResults.push(result);

      log(`✅ ${result.textsPerSec.toFixed(1)} texts/sec`, 'green');
    }
  }

  // Display results
  displaySerialResults(serialResults);
  displayConcurrentResults(concurrentResults);

  // Summary
  logSection('SUMMARY');

  const bestSerial = serialResults.reduce((best, current) =>
    current.textsPerSec > best.textsPerSec ? current : best
  );

  const bestConcurrent = concurrentResults.reduce((best, current) =>
    current.textsPerSec > best.textsPerSec ? current : best
  );

  console.log('\nBest Serial Performance:');
  console.log(`  - Text Size: ${bestSerial.textSize} chars`);
  console.log(`  - Batch Size: ${bestSerial.batchSize}`);
  console.log(`  - Throughput: ${bestSerial.textsPerSec.toFixed(1)} texts/sec (${bestSerial.charsPerSec.toFixed(0)} chars/sec)`);
  console.log(`  - Latency: ${Math.round(bestSerial.avg)}ms (p95: ${Math.round(bestSerial.p95)}ms)`);

  console.log('\nBest Concurrent Performance:');
  console.log(`  - Threads: ${bestConcurrent.threads}`);
  console.log(`  - Text Size: ${bestConcurrent.textSize} chars, Batch: ${bestConcurrent.batchSize}`);
  console.log(`  - Throughput: ${bestConcurrent.textsPerSec.toFixed(1)} texts/sec (${bestConcurrent.charsPerSec.toFixed(0)} chars/sec)`);
  const baseline = concurrentResults.find(r => r.textSize === bestConcurrent.textSize && r.batchSize === bestConcurrent.batchSize && r.threads === 1);
  if (baseline) {
    const efficiency = ((bestConcurrent.textsPerSec / baseline.textsPerSec) / bestConcurrent.threads * 100).toFixed(0);
    console.log(`  - Efficiency: ${efficiency}%`);
  }

  // Export if requested
  if (exportCsv) {
    exportCSV([...serialResults, ...concurrentResults], exportCsv);
  }

  if (exportJson) {
    exportJSON({ serial: serialResults, concurrent: concurrentResults, summary: { bestSerial, bestConcurrent }}, exportJson);
  }

  log('\n✅ Performance benchmark complete!', 'green');
}

// ============================================================================
// END PERFORMANCE TESTING FUNCTIONS
// ============================================================================

/**
 * Test a single batch file
 */
async function testBatchFile(batchFile, compareWithOllama) {
  logSection(`Testing: ${path.basename(batchFile)}`);
  log(`File: ${batchFile}`, 'cyan');

  let batch;
  try {
    const content = fs.readFileSync(batchFile, 'utf-8');
    batch = JSON.parse(content);
  } catch (error) {
    log(`❌ Failed to load batch file: ${error.message}`, 'red');
    return { file: batchFile, success: false, error: error.message };
  }

  analyzeBatch(batch);

  const fullResult = await testFullBatch(batch, compareWithOllama);

  if (!fullResult.success) {
    // If full batch failed, test individual texts
    const individualResult = await testIndividualTexts(batch.texts);

    if (individualResult.failed.length === 0) {
      log('\n🤔 Interesting: All texts work individually but fail in batch', 'yellow');
      log('   This suggests a batching or total size issue', 'yellow');
      await testSubBatches(batch.texts);
    } else {
      log(`\n⚠️  ${individualResult.failed.length} texts fail even individually`, 'yellow');
      log('   The problem is with specific text content', 'yellow');
    }
  }

  return {
    file: batchFile,
    success: fullResult.success,
    duration: fullResult.duration,
    chunkCount: batch.chunkCount,
    totalChars: batch.totalChars
  };
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Usage: node scripts/test-python-sidecar.js [options] <batch-file(s)>

Options:
  --help              Show this help message
  --all               Test all failed-batch-*.json files on Desktop
  --compare-ollama    Compare results with Ollama

  --perf              Run performance benchmarks
  --quick             Quick performance test (fewer iterations)
  --max-threads=N     Max concurrent threads for perf tests (default: 5)
  --max-size=N        Max text size for perf tests (default: 10000)
  --export-csv=FILE   Export performance results to CSV
  --export-json=FILE  Export performance results to JSON

Examples:
  # Test single batch
  node scripts/test-python-sidecar.js ~/Desktop/failed-batch-2025-10-26.json

  # Test all batches on Desktop
  node scripts/test-python-sidecar.js --all

  # Test with Ollama comparison
  node scripts/test-python-sidecar.js --compare-ollama ~/Desktop/failed-batch-*.json

  # Run full performance benchmark
  node scripts/test-python-sidecar.js --perf

  # Quick performance test
  node scripts/test-python-sidecar.js --perf --quick

  # Performance test with custom config and export
  node scripts/test-python-sidecar.js --perf --max-threads=3 --export-csv=results.csv

  # Use custom sidecar port
  EMBED_PORT=8421 node scripts/test-python-sidecar.js --all

Environment variables:
  EMBED_HOST       - Sidecar host (default: 127.0.0.1)
  EMBED_PORT       - Sidecar port (default: 8421)
  OLLAMA_URL       - Ollama URL (default: http://127.0.0.1:11434)
  OLLAMA_MODEL     - Ollama model (default: nomic-embed-text)
    `);
    process.exit(0);
  }

  let batchFiles = [];
  let compareWithOllama = false;
  let perfMode = false;
  let perfOptions = {
    quick: false,
    maxThreads: 5,
    maxSize: 10000,
    exportCsv: null,
    exportJson: null
  };

  // Parse arguments
  for (const arg of args) {
    if (arg === '--all') {
      const desktopPath = path.join(require('os').homedir(), 'Desktop');
      const pattern = path.join(desktopPath, 'failed-batch-*.json');
      batchFiles = await glob(pattern);
      if (batchFiles.length === 0) {
        log(`❌ No failed batch files found on Desktop`, 'red');
        process.exit(1);
      }
      log(`Found ${batchFiles.length} failed batch files`, 'cyan');
    } else if (arg === '--compare-ollama') {
      compareWithOllama = true;
    } else if (arg === '--perf' || arg === '--benchmark') {
      perfMode = true;
    } else if (arg === '--quick') {
      perfOptions.quick = true;
    } else if (arg.startsWith('--max-threads=')) {
      perfOptions.maxThreads = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--max-size=')) {
      perfOptions.maxSize = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--export-csv=')) {
      perfOptions.exportCsv = arg.split('=')[1];
    } else if (arg.startsWith('--export-json=')) {
      perfOptions.exportJson = arg.split('=')[1];
    } else if (arg.startsWith('--')) {
      log(`❌ Unknown option: ${arg}`, 'red');
      process.exit(1);
    } else {
      // Check if it's a glob pattern
      if (arg.includes('*')) {
        const matches = await glob(arg);
        batchFiles.push(...matches);
      } else if (fs.existsSync(arg)) {
        batchFiles.push(arg);
      } else {
        log(`❌ File not found: ${arg}`, 'red');
        process.exit(1);
      }
    }
  }

  // Check sidecar health first
  const healthy = await checkSidecarHealth();
  if (!healthy) {
    log('\n⚠️  Sidecar health check failed. Start the sidecar before testing.', 'yellow');
    log(`   cd embedding_sidecar && python embed_server.py`, 'cyan');
    process.exit(1);
  }

  // Performance mode
  if (perfMode) {
    await runPerformanceBenchmark(perfOptions);
    process.exit(0);
  }

  // Batch file mode
  if (batchFiles.length === 0) {
    log('❌ No batch files specified', 'red');
    log('   Use --all, --perf, or provide file path(s)', 'yellow');
    process.exit(1);
  }

  // Test each batch file
  const results = [];
  for (let i = 0; i < batchFiles.length; i++) {
    const batchFile = batchFiles[i];
    log(`\n${'#'.repeat(70)}`, 'magenta');
    log(`BATCH ${i + 1}/${batchFiles.length}`, 'magenta');
    log(`${'#'.repeat(70)}`, 'magenta');

    const result = await testBatchFile(batchFile, compareWithOllama);
    results.push(result);

    // Add small delay between batches
    if (i < batchFiles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Final summary
  logSection('FINAL SUMMARY');

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalChunks = results.reduce((sum, r) => sum + (r.chunkCount || 0), 0);
  const totalChars = results.reduce((sum, r) => sum + (r.totalChars || 0), 0);

  log(`\nTested ${results.length} batch files:`, 'cyan');
  log(`  ✅ Successful: ${successful}`, successful > 0 ? 'green' : 'reset');
  log(`  ❌ Failed: ${failed}`, failed > 0 ? 'red' : 'reset');
  log(`\nTotal processed: ${totalChunks} chunks, ${totalChars.toLocaleString()} chars`, 'cyan');

  if (successful === results.length) {
    log('\n🎉 ALL TESTS PASSED! Python sidecar handles all failed batches correctly.', 'green');
    process.exit(0);
  } else {
    log(`\n⚠️  ${failed} batch(es) still failing. Review output above for details.`, 'yellow');
    process.exit(1);
  }
}

main().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error.stack);
  process.exit(1);
});
