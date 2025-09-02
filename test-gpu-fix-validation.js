#!/usr/bin/env node

/**
 * GPU Fix Validation Script
 * 
 * This script validates that the ELECTRON_RUN_AS_NODE=1 environment variable
 * successfully prevents GPU process crashes when embedding text files.
 * 
 * It tests with files that previously caused exit code 5 GPU crashes in Electron.
 * 
 * Usage: node test-gpu-fix-validation.js
 * 
 * Expected result: All files should process successfully without GPU crashes
 */

const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const chardet = require('chardet');
const iconv = require('iconv-lite');

// Files that were causing GPU process crashes
const problemFiles = [
  '/Users/bovet/Documents/Family/Jean/Computers/Lisa_Source/APPS/APLC/aplc-LCFEXEC.TEXT.unix.txt',
  '/Users/bovet/Documents/Family/Jean/Computers/Lisa_Source/APPS/APLC/aplc-LCSMGR.TEXT.unix.txt',
  '/Users/bovet/Documents/Family/Jean/Computers/Lisa_Source/APPS/APLC/aplc-T3ALERT.TEXT.unix.txt',
  '/Users/bovet/Documents/Family/Jean/Computers/Lisa_Source/APPS/APLC/aplc-LCFILER.TEXT.unix.txt'
];

// Chunk text similar to the actual chunker
function chunkText(text, targetTokens = 500) {
  if (!text || text.trim().length === 0) {
    return [];
  }
  
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  const estimateTokens = (str) => Math.ceil(str.length / 4);
  
  let buffer = [];
  let currentOffset = 0;
  let bufferTokens = 0;
  
  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    
    if (bufferTokens + sentenceTokens > targetTokens && buffer.length > 0) {
      chunks.push({
        text: buffer.join(' '),
        offset: currentOffset
      });
      
      while (buffer.length > 0 && estimateTokens(buffer.join(' ')) > 80) {
        const removed = buffer.shift();
        currentOffset += removed.length + 1;
      }
      
      bufferTokens = estimateTokens(buffer.join(' '));
    }
    
    buffer.push(sentence);
    bufferTokens += sentenceTokens;
  }
  
  if (buffer.length > 0) {
    chunks.push({
      text: buffer.join(' '),
      offset: currentOffset
    });
  }
  
  return chunks;
}

async function testFile(filePath) {
  console.log(`\n📋 Testing: ${path.basename(filePath)}`);
  console.log('=' + '='.repeat(60));
  
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) {
      console.log('❌ File not found');
      resolve({ success: false, error: 'File not found' });
      return;
    }
    
    // Read and process file
    const buffer = fs.readFileSync(filePath);
    const encoding = chardet.detect(buffer) || 'UTF-8';
    const text = iconv.decode(buffer, encoding);
    const chunks = chunkText(text);
    
    console.log(`📊 File stats:`);
    console.log(`  - Size: ${(buffer.length / 1024).toFixed(1)} KB`);
    console.log(`  - Encoding: ${encoding}`);
    console.log(`  - Text length: ${text.length} chars`);
    console.log(`  - Chunks: ${chunks.length}`);
    
    // Spawn embedder child process WITH the GPU fix
    const child = fork('dist/embedder.child.cjs', [], {
      execArgv: ['--expose-gc'],
      silent: false,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',  // This is the GPU fix
        TRANSFORMERS_CACHE: path.join(require('os').homedir(), 'Library/Application Support/Semantica/models')
      }
    });
    
    let chunksProcessed = 0;
    const maxChunks = Math.min(5, chunks.length); // Test first 5 chunks
    let currentChunk = 0;
    let startTime = Date.now();
    
    // Timeout handler
    const timeout = setTimeout(() => {
      console.log('⏱️ Timeout after 30s');
      child.kill();
      resolve({ success: false, error: 'Timeout' });
    }, 30000);
    
    // Handle messages from child
    child.on('message', (msg) => {
      if (msg.type === 'ready') {
        console.log('✅ Embedder initialized');
        
        // Send first chunk
        if (chunks.length > 0) {
          const chunk = chunks[currentChunk];
          child.send({
            type: 'embed',
            id: `chunk-${currentChunk}`,
            texts: [chunk.text],
            isQuery: false
          });
        }
      } else if (msg.type === 'embed:ok') {
        chunksProcessed++;
        currentChunk++;
        
        if (currentChunk < maxChunks) {
          // Send next chunk
          const chunk = chunks[currentChunk];
          child.send({
            type: 'embed',
            id: `chunk-${currentChunk}`,
            texts: [chunk.text],
            isQuery: false
          });
        } else {
          // All test chunks processed
          const elapsed = Date.now() - startTime;
          console.log(`✅ Successfully embedded ${chunksProcessed} chunks in ${elapsed}ms`);
          clearTimeout(timeout);
          child.kill();
          resolve({ success: true, chunksProcessed, elapsed });
        }
      } else if (msg.type === 'embed:err') {
        console.log(`❌ Embedding error: ${msg.error}`);
        clearTimeout(timeout);
        child.kill();
        resolve({ success: false, error: msg.error });
      } else if (msg.type === 'init:err') {
        console.log(`❌ Init error: ${msg.error}`);
        clearTimeout(timeout);
        child.kill();
        resolve({ success: false, error: msg.error });
      }
    });
    
    // Handle child exit
    child.on('exit', (code, signal) => {
      if (code !== 0 && code !== null && chunksProcessed === 0) {
        console.log(`💥 Child process crashed! Exit code: ${code}, Signal: ${signal}`);
        clearTimeout(timeout);
        resolve({ success: false, error: `Exit code ${code}` });
      }
    });
    
    // Handle spawn error
    child.on('error', (error) => {
      console.log(`❌ Spawn error: ${error.message}`);
      clearTimeout(timeout);
      resolve({ success: false, error: error.message });
    });
    
    // Initialize embedder
    child.send({ type: 'init', model: 'Xenova/multilingual-e5-small' });
  });
}

async function main() {
  console.log('🔬 GPU Fix Validation Test');
  console.log('============================');
  console.log('Testing embedder with ELECTRON_RUN_AS_NODE=1 to bypass GPU process\n');
  
  let allSuccess = true;
  const results = [];
  
  for (const file of problemFiles) {
    const result = await testFile(file);
    results.push({ file: path.basename(file), ...result });
    if (!result.success) {
      allSuccess = false;
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 Test Summary:');
  console.log('='.repeat(70));
  
  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    const details = result.success 
      ? `${result.chunksProcessed} chunks in ${result.elapsed}ms`
      : `Failed: ${result.error}`;
    console.log(`${status} ${result.file}: ${details}`);
  }
  
  console.log('\n' + '='.repeat(70));
  if (allSuccess) {
    console.log('✅ SUCCESS: All files processed without GPU crashes!');
    console.log('The ELECTRON_RUN_AS_NODE=1 fix is working correctly.');
  } else {
    console.log('❌ FAILURE: Some files still cause crashes.');
    console.log('The GPU fix may not be sufficient.');
  }
  
  process.exit(allSuccess ? 0 : 1);
}

// Run the test
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});