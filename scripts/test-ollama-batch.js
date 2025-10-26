#!/usr/bin/env node

/**
 * Standalone script to test Ollama with failed batches
 *
 * Usage:
 *   node scripts/test-ollama-batch.js ~/Desktop/failed-batch-*.json
 *   node scripts/test-ollama-batch.js --help
 *
 * This script:
 * 1. Loads a failed batch JSON file
 * 2. Tests the full batch with Ollama
 * 3. Tests each text individually
 * 4. Tests sub-batches to find the problematic text
 */

const fs = require('node:fs');
const path = require('node:path');

// Configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.MODEL || 'bge-m3';
const TIMEOUT_MS = 30000; // 30 seconds

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60));
}

/**
 * Send embed request to Ollama
 */
async function embedBatch(texts, model = MODEL) {
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
        error: responseText,
        texts: texts
      };
    }

    const data = JSON.parse(responseText);
    return {
      success: true,
      status: response.status,
      embeddings: data.embeddings,
      texts: texts
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      success: false,
      error: error.message,
      texts: texts
    };
  }
}

/**
 * Test the full batch
 */
async function testFullBatch(batch) {
  logSection(`Test 1: Full Batch (${batch.chunkCount} texts)`);

  console.log(`Chars: ${batch.totalChars}`);
  console.log(`Est. Tokens: ${batch.estimatedTokens}`);
  console.log(`Original Error: ${batch.error}`);
  console.log('\nSending request to Ollama...');

  const result = await embedBatch(batch.texts);

  if (result.success) {
    log('✅ SUCCESS: Full batch processed!', 'green');
    console.log(`Generated ${result.embeddings.length} embeddings`);
    return { success: true, failedTexts: [] };
  } else {
    log(`❌ FAILED: ${result.error}`, 'red');
    console.log(`Status: ${result.status}`);
    return { success: false, failedTexts: batch.texts };
  }
}

/**
 * Test each text individually
 */
async function testIndividualTexts(texts) {
  logSection(`Test 2: Individual Texts (${texts.length} texts)`);

  const results = [];
  const failed = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    process.stdout.write(`Testing text ${i + 1}/${texts.length}... `);

    const result = await embedBatch([text]);

    if (result.success) {
      log('✅', 'green');
      results.push({ index: i, success: true });
    } else {
      log(`❌ ${result.error}`, 'red');
      results.push({ index: i, success: false, error: result.error });
      failed.push({ index: i, text: text, error: result.error });
    }
  }

  console.log(`\n${results.filter(r => r.success).length}/${texts.length} texts succeeded`);

  if (failed.length > 0) {
    log(`\n⚠️  Failed texts:`, 'yellow');
    failed.forEach(({ index, text, error }) => {
      console.log(`  [${index}] ${text.substring(0, 100)}...`);
      console.log(`      Error: ${error}`);
    });
  }

  return { results, failed };
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
  for (let i = 0; i < texts.length - 1; i++) {
    process.stdout.write(`  Pair [${i}, ${i+1}]... `);
    const result = await embedBatch([texts[i], texts[i + 1]]);

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
    const firstHalf = await embedBatch(texts.slice(0, mid));
    log(firstHalf.success ? '✅' : `❌ ${firstHalf.error}`, firstHalf.success ? 'green' : 'red');

    process.stdout.write(`  Second half (${mid}-${texts.length-1})... `);
    const secondHalf = await embedBatch(texts.slice(mid));
    log(secondHalf.success ? '✅' : `❌ ${secondHalf.error}`, secondHalf.success ? 'green' : 'red');
  }
}

/**
 * Check Ollama server health
 */
async function checkOllamaHealth() {
  logSection('Ollama Server Health Check');

  try {
    // Check if server is running
    const tagsResponse = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!tagsResponse.ok) {
      log('❌ Ollama server not responding correctly', 'red');
      return false;
    }

    log('✅ Ollama server is running', 'green');

    // List models
    const data = await tagsResponse.json();
    console.log(`\nAvailable models: ${data.models.map(m => m.name).join(', ')}`);

    // Check if our model is available
    const hasModel = data.models.some(m => m.name === MODEL || m.name.startsWith(MODEL + ':'));
    if (hasModel) {
      log(`✅ Model '${MODEL}' is available`, 'green');
    } else {
      log(`❌ Model '${MODEL}' not found!`, 'red');
      log(`   Run: ollama pull ${MODEL}`, 'yellow');
      return false;
    }

    // Try simple embed request
    console.log('\nTesting simple embed request...');
    const testResult = await embedBatch(['hello world']);

    if (testResult.success) {
      log('✅ Simple embed request works', 'green');
      return true;
    } else {
      log(`❌ Simple embed failed: ${testResult.error}`, 'red');
      return false;
    }

  } catch (error) {
    log(`❌ Ollama health check failed: ${error.message}`, 'red');
    log(`   Make sure Ollama is running: ollama serve`, 'yellow');
    return false;
  }
}

/**
 * Analyze batch content
 */
function analyzeBatch(batch) {
  logSection('Batch Analysis');

  console.log(`Timestamp: ${batch.timestamp}`);
  console.log(`Batch ID: ${batch.batchId}`);
  console.log(`Chunk Count: ${batch.chunkCount}`);
  console.log(`Total Characters: ${batch.totalChars.toLocaleString()}`);
  console.log(`Estimated Tokens: ${batch.estimatedTokens.toLocaleString()}`);
  console.log(`Text Lengths: [${batch.textLengths.join(', ')}]`);

  // Character analysis
  const totalChars = batch.texts.reduce((sum, t) => sum + t.length, 0);
  const nonAscii = batch.texts.reduce((sum, t) => {
    return sum + (t.match(/[^\x00-\x7F]/g) || []).length;
  }, 0);
  const pctNonAscii = ((nonAscii / totalChars) * 100).toFixed(1);

  console.log(`\nNon-ASCII chars: ${nonAscii} (${pctNonAscii}%)`);

  // Show previews
  console.log(`\nFirst text preview:`);
  console.log(`  "${batch.texts[0].substring(0, 150)}..."`);

  if (batch.texts.length > 1) {
    console.log(`\nLast text preview:`);
    const lastText = batch.texts[batch.texts.length - 1];
    console.log(`  "...${lastText.substring(Math.max(0, lastText.length - 150))}"`);
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Usage: node scripts/test-ollama-batch.js <batch-file.json>

Examples:
  node scripts/test-ollama-batch.js ~/Desktop/failed-batch-2025-10-26.json
  MODEL=nomic-embed-text node scripts/test-ollama-batch.js batch.json
  OLLAMA_URL=http://localhost:11434 node scripts/test-ollama-batch.js batch.json

Environment variables:
  OLLAMA_URL - Ollama server URL (default: http://127.0.0.1:11434)
  MODEL      - Model to use (default: bge-m3)
    `);
    process.exit(0);
  }

  const batchFile = args[0];

  if (!fs.existsSync(batchFile)) {
    log(`❌ File not found: ${batchFile}`, 'red');
    process.exit(1);
  }

  log(`\nLoading batch from: ${batchFile}`, 'cyan');

  let batch;
  try {
    const content = fs.readFileSync(batchFile, 'utf-8');
    batch = JSON.parse(content);
  } catch (error) {
    log(`❌ Failed to load batch file: ${error.message}`, 'red');
    process.exit(1);
  }

  // Run tests
  analyzeBatch(batch);

  const healthy = await checkOllamaHealth();
  if (!healthy) {
    log('\n⚠️  Ollama health check failed. Fix Ollama before testing batch.', 'yellow');
    process.exit(1);
  }

  const fullResult = await testFullBatch(batch);

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

  logSection('Summary');
  log(`Ollama: ${OLLAMA_BASE_URL}`, 'cyan');
  log(`Model: ${MODEL}`, 'cyan');
  log(`Full batch: ${fullResult.success ? '✅ PASS' : '❌ FAIL'}`, fullResult.success ? 'green' : 'red');
  console.log('\nCheck the output above for details.');
}

main().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error.stack);
  process.exit(1);
});
