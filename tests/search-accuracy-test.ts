#!/usr/bin/env npx tsx

/**
 * Search Accuracy Test Script
 * 
 * This script tests that specific search queries return expected files with expected similarity scores.
 * 
 * Usage:
 *   npx tsx tests/search-accuracy-test.ts
 * 
 * Or add test cases directly in the script and run it.
 */

import { Worker } from 'node:worker_threads';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

interface TestCase {
  name: string;
  fileContent: string;
  fileName: string;
  searchQuery: string;
  expectedMinScore: number; // Minimum similarity score expected (0-1)
  expectedMaxScore?: number; // Optional maximum score for range testing
}

interface TestCaseWithFile {
  name: string;
  filePath: string; // Path to existing file to copy
  searchQuery: string;
  expectedMinScore: number;
  expectedMaxScore?: number;
}

// Define your test cases here
const TEST_CASES: TestCase[] = [
  {
    name: "Basic content match",
    fileName: "test-doc.txt",
    fileContent: "The quick brown fox jumps over the lazy dog. This is a test document for search accuracy.",
    searchQuery: "quick brown fox",
    expectedMinScore: 0.7
  },
  {
    name: "Semantic similarity test",
    fileName: "semantic-test.txt",
    fileContent: "Machine learning models can process natural language and understand context.",
    searchQuery: "AI understands text meaning",
    expectedMinScore: 0.5  // Lower threshold for semantic matching
  },
];

// Test cases that use existing files
const FILE_TEST_CASES: TestCaseWithFile[] = [
  {
    name: "French legal document - Résiliation bail Neuchâtel",
    filePath: "/Users/bovet/Documents/Family/Jean/Courrier/2000/Lettre du 17 décembre.doc",
    searchQuery: "resiliation bail neuchatel pour depart usa",
    expectedMinScore: 0.80,  // 80% match expected (lowered for initial testing)
    expectedMaxScore: 0.95   // Allow some variance up to 95%
  }
];

class SearchAccuracyTester {
  private worker: Worker | null = null;
  private tempDir: string = '';
  private dbDir: string = '';
  private workerReady = false;
  private messageHandlers = new Map<string, (payload: any) => void>();

  async setup() {
    // Create temporary directories
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-test-'));
    this.dbDir = path.join(this.tempDir, 'db');
    const testFilesDir = path.join(this.tempDir, 'files');
    const testModelsDir = path.join(this.tempDir, 'models');
    
    fs.mkdirSync(this.dbDir, { recursive: true });
    fs.mkdirSync(testFilesDir, { recursive: true });
    fs.mkdirSync(testModelsDir, { recursive: true });
    
    console.log(`📁 Test directory: ${this.tempDir}`);
    
    // Copy existing models from Semantica if available
    const semanticaModelsPath = path.join(os.homedir(), 'Library', 'Application Support', 'Semantica', 'models');
    if (fs.existsSync(semanticaModelsPath)) {
      console.log('📦 Copying existing models from Semantica...');
      const copyRecursive = (src: string, dest: string) => {
        const exists = fs.existsSync(src);
        const stats = exists && fs.statSync(src);
        const isDirectory = exists && stats && stats.isDirectory();
        
        if (isDirectory) {
          fs.mkdirSync(dest, { recursive: true });
          fs.readdirSync(src).forEach((childItemName) => {
            copyRecursive(
              path.join(src, childItemName),
              path.join(dest, childItemName)
            );
          });
        } else {
          fs.copyFileSync(src, dest);
        }
      };
      
      copyRecursive(semanticaModelsPath, testModelsDir);
      console.log('✅ Models copied successfully');
    }
    
    // Start worker
    const workerPath = path.join(__dirname, '../dist/worker.cjs');
    if (!fs.existsSync(workerPath)) {
      throw new Error(`Worker not found at ${workerPath}. Please run 'npm run build' first.`);
    }
    
    // Set up environment for worker
    // Use the copied models
    const workerEnv = {
      ...process.env,
      NODE_ENV: 'development', // Use development to avoid resourcesPath issues
      USER_DATA_PATH: this.tempDir,
      TRANSFORMERS_CACHE: testModelsDir // Use copied models
    };
    
    this.worker = new Worker(workerPath, {
      env: workerEnv,
      resourceLimits: {
        maxOldGenerationSizeMb: 2048,
        maxYoungGenerationSizeMb: 512
      }
    });
    
    // Set up message handling
    this.worker.on('message', (msg) => {
      console.log('[TEST] Worker message:', msg.type);
      if (msg.type === 'ready') {
        this.workerReady = true;
        console.log('[TEST] Worker is ready');
      } else if (msg.type === 'model:ready') {
        console.log('[TEST] Model ready:', msg.payload);
      } else if (msg.id && this.messageHandlers.has(msg.id)) {
        const handler = this.messageHandlers.get(msg.id);
        this.messageHandlers.delete(msg.id);
        handler?.(msg.payload || msg);
      }
    });
    
    this.worker.on('error', (err) => {
      console.error('[TEST] Worker error:', err);
    });
    
    // Initialize worker - don't wait for response, worker sends 'ready' directly
    this.worker.postMessage({ 
      type: 'init', 
      dbDir: this.dbDir,
      userDataPath: this.tempDir 
    });
    
    // Wait for worker to be ready
    await this.waitForWorkerReady();
    
    // Configure settings to enable all file types
    await this.sendMessage('updateSettings', {
      excludeBundles: true,
      fileTypes: {
        pdf: true,
        txt: true,
        md: true,
        docx: true,
        rtf: true,
        doc: true
      }
    });
    
    return testFilesDir;
  }
  
  private async waitForWorkerReady() {
    const maxWait = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (!this.workerReady) {
      if (Date.now() - startTime > maxWait) {
        throw new Error('Worker initialization timeout');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Additional wait for model to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  private sendMessage(type: string, payload?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }
      
      const id = Math.random().toString(36).substring(7);
      // Longer timeout for init and model operations
      const timeoutMs = type === 'init' || type === 'checkModel' || type === 'downloadModel' ? 120000 : 30000;
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(id);
        reject(new Error(`Timeout waiting for response to ${type}`));
      }, timeoutMs);
      
      this.messageHandlers.set(id, (response) => {
        clearTimeout(timeout);
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
      
      // For init message, spread the payload directly
      if (type === 'init') {
        this.worker.postMessage({ type, ...payload, id });
      } else {
        this.worker.postMessage({ type, payload, id });
      }
    });
  }
  
  async indexFiles(testFilesDir: string, testCases: TestCase[]) {
    // Create test files
    const filePaths: string[] = [];
    for (const testCase of testCases) {
      const filePath = path.join(testFilesDir, testCase.fileName);
      fs.writeFileSync(filePath, testCase.fileContent);
      filePaths.push(filePath);
      console.log(`📝 Created test file: ${testCase.fileName}`);
    }
    
    // Start watching the directory
    await this.sendMessage('watchStart', {
      roots: [testFilesDir],
      options: { exclude: [] }
    });
    
    // Wait for indexing to complete
    console.log('⏳ Waiting for indexing to complete...');
    await this.waitForIndexingComplete();
    
    return filePaths;
  }
  
  async indexExistingFiles(testFilesDir: string, fileTestCases: TestCaseWithFile[]) {
    // Copy existing files to test directory
    const filePaths: string[] = [];
    for (const testCase of fileTestCases) {
      if (!fs.existsSync(testCase.filePath)) {
        console.log(`⚠️  Skipping test "${testCase.name}" - file not found: ${testCase.filePath}`);
        continue;
      }
      
      const fileName = path.basename(testCase.filePath);
      const destPath = path.join(testFilesDir, fileName);
      fs.copyFileSync(testCase.filePath, destPath);
      filePaths.push(destPath);
      console.log(`📝 Copied test file: ${fileName}`);
    }
    
    if (filePaths.length > 0) {
      // Start watching the directory
      await this.sendMessage('watchStart', {
        roots: [testFilesDir],
        options: { exclude: [] }
      });
      
      // Wait for indexing to complete
      console.log('⏳ Waiting for indexing to complete...');
      await this.waitForIndexingComplete();
    }
    
    return filePaths;
  }
  
  private async waitForIndexingComplete() {
    const maxWait = 60000; // 60 seconds
    const startTime = Date.now();
    
    while (true) {
      if (Date.now() - startTime > maxWait) {
        throw new Error('Indexing timeout');
      }
      
      const progress = await this.sendMessage('progress');
      
      if (progress.queued === 0 && progress.processing === 0 && progress.done > 0) {
        console.log(`✅ Indexing complete: ${progress.done} files indexed`);
        break;
      }
      
      console.log(`⏳ Indexing progress: ${progress.processing} processing, ${progress.queued} queued, ${progress.done} done`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  async runSearchTests(testCases: TestCase[]) {
    console.log('\n🔍 Running search tests...\n');
    
    const results = [];
    
    for (const testCase of testCases) {
      console.log(`📊 Test: ${testCase.name}`);
      console.log(`   Query: "${testCase.searchQuery}"`);
      
      try {
        const searchResults = await this.sendMessage('search', {
          q: testCase.searchQuery,
          k: 10
        });
        
        // Find the test file in results
        const fileResult = searchResults.find((r: any) => 
          path.basename(r.path) === testCase.fileName
        );
        
        if (!fileResult) {
          console.log(`   ❌ FAILED: File not found in search results`);
          console.log(`   Results returned: ${searchResults.map((r: any) => path.basename(r.path)).join(', ')}`);
          results.push({ 
            testCase: testCase.name, 
            passed: false, 
            reason: 'File not found in results' 
          });
        } else {
          const score = fileResult.score;
          const passed = score >= testCase.expectedMinScore && 
                        (!testCase.expectedMaxScore || score <= testCase.expectedMaxScore);
          
          if (passed) {
            console.log(`   ✅ PASSED: Score ${(score * 100).toFixed(1)}% (expected ≥ ${(testCase.expectedMinScore * 100).toFixed(1)}%)`);
          } else {
            console.log(`   ❌ FAILED: Score ${(score * 100).toFixed(1)}% (expected ≥ ${(testCase.expectedMinScore * 100).toFixed(1)}%)`);
          }
          
          console.log(`   Matched text: "${fileResult.text.substring(0, 100)}..."`);
          
          results.push({
            testCase: testCase.name,
            passed,
            score,
            expectedMin: testCase.expectedMinScore,
            expectedMax: testCase.expectedMaxScore
          });
        }
      } catch (error) {
        console.log(`   ❌ ERROR: ${error}`);
        results.push({
          testCase: testCase.name,
          passed: false,
          error: String(error)
        });
      }
      
      console.log();
    }
    
    return results;
  }
  
  async runFileSearchTests(fileTestCases: TestCaseWithFile[]) {
    console.log('\n🔍 Running file-based search tests...\n');
    
    const results = [];
    
    for (const testCase of fileTestCases) {
      if (!fs.existsSync(testCase.filePath)) {
        console.log(`📊 Test: ${testCase.name}`);
        console.log(`   ⚠️  SKIPPED: File not found - ${testCase.filePath}`);
        results.push({
          testCase: testCase.name,
          passed: false,
          reason: 'File not found'
        });
        continue;
      }
      
      const fileName = path.basename(testCase.filePath);
      console.log(`📊 Test: ${testCase.name}`);
      console.log(`   File: ${fileName}`);
      console.log(`   Query: "${testCase.searchQuery}"`);
      
      try {
        const searchResults = await this.sendMessage('search', {
          q: testCase.searchQuery,
          k: 10
        });
        
        // Find the test file in results
        const fileResult = searchResults.find((r: any) => 
          path.basename(r.path) === fileName
        );
        
        if (!fileResult) {
          console.log(`   ❌ FAILED: File not found in search results`);
          console.log(`   Results returned: ${searchResults.map((r: any) => path.basename(r.path)).join(', ')}`);
          results.push({ 
            testCase: testCase.name, 
            passed: false, 
            reason: 'File not found in results' 
          });
        } else {
          const score = fileResult.score;
          const passed = score >= testCase.expectedMinScore && 
                        (!testCase.expectedMaxScore || score <= testCase.expectedMaxScore);
          
          if (passed) {
            console.log(`   ✅ PASSED: Score ${(score * 100).toFixed(1)}% (expected ${(testCase.expectedMinScore * 100).toFixed(0)}%-${testCase.expectedMaxScore ? (testCase.expectedMaxScore * 100).toFixed(0) : '100'}%)`);
          } else {
            console.log(`   ❌ FAILED: Score ${(score * 100).toFixed(1)}% (expected ${(testCase.expectedMinScore * 100).toFixed(0)}%-${testCase.expectedMaxScore ? (testCase.expectedMaxScore * 100).toFixed(0) : '100'}%)`);
          }
          
          console.log(`   Matched text: "${fileResult.text.substring(0, 100)}..."`);
          
          results.push({
            testCase: testCase.name,
            passed,
            score,
            expectedMin: testCase.expectedMinScore,
            expectedMax: testCase.expectedMaxScore
          });
        }
      } catch (error) {
        console.log(`   ❌ ERROR: ${error}`);
        results.push({
          testCase: testCase.name,
          passed: false,
          error: String(error)
        });
      }
      
      console.log();
    }
    
    return results;
  }
  
  async cleanup() {
    if (this.worker) {
      this.worker.postMessage({ type: 'shutdown' });
      await new Promise(resolve => setTimeout(resolve, 500));
      await this.worker.terminate();
    }
    
    if (fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    }
  }
  
  async runSpecificSearchTest(
    filePath: string,
    searchQuery: string,
    expectedScore?: number
  ) {
    console.log('\n🔍 Running specific file search test...\n');
    console.log(`📄 File: ${filePath}`);
    console.log(`🔎 Query: "${searchQuery}"`);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    // Create a copy of the file in our test directory
    const testFilesDir = path.join(this.tempDir, 'files');
    const fileName = path.basename(filePath);
    const testFilePath = path.join(testFilesDir, fileName);
    
    fs.copyFileSync(filePath, testFilePath);
    console.log(`📝 Copied file to test directory`);
    
    // Start watching and index
    await this.sendMessage('watchStart', {
      roots: [testFilesDir],
      options: { exclude: [] }
    });
    
    await this.waitForIndexingComplete();
    
    // Run search
    const searchResults = await this.sendMessage('search', {
      q: searchQuery,
      k: 10
    });
    
    // Find the file in results
    const fileResult = searchResults.find((r: any) => 
      path.basename(r.path) === fileName
    );
    
    if (!fileResult) {
      console.log(`\n❌ File not found in search results`);
      console.log(`Results returned (${searchResults.length} total):`);
      searchResults.forEach((r: any, i: number) => {
        console.log(`  ${i + 1}. ${path.basename(r.path)} - Score: ${(r.score * 100).toFixed(1)}%`);
        console.log(`     Text: "${r.text.substring(0, 80)}..."`);
      });
    } else {
      const score = fileResult.score;
      console.log(`\n✅ File found in search results`);
      console.log(`   Score: ${(score * 100).toFixed(1)}%`);
      
      if (expectedScore !== undefined) {
        const diff = Math.abs(score - expectedScore);
        if (diff < 0.05) { // 5% tolerance
          console.log(`   ✅ Score matches expected: ${(expectedScore * 100).toFixed(1)}% ±5%`);
        } else {
          console.log(`   ⚠️  Score differs from expected: ${(expectedScore * 100).toFixed(1)}%`);
        }
      }
      
      console.log(`\n📊 Full result details:`);
      console.log(`   Position in results: #${searchResults.indexOf(fileResult) + 1}`);
      console.log(`   Matched chunk: "${fileResult.text}"`);
      console.log(`   Page: ${fileResult.page || 'N/A'}`);
      console.log(`   Offset: ${fileResult.offset}`);
    }
    
    return {
      found: !!fileResult,
      score: fileResult?.score,
      text: fileResult?.text,
      position: fileResult ? searchResults.indexOf(fileResult) + 1 : -1
    };
  }
}

// Main execution
async function main() {
  const tester = new SearchAccuracyTester();
  
  try {
    console.log('🚀 Starting Search Accuracy Tests\n');
    
    const testFilesDir = await tester.setup();
    
    // Check for command line arguments for specific file testing
    const args = process.argv.slice(2);
    if (args.length >= 2) {
      // Specific file test mode
      const filePath = args[0];
      const searchQuery = args[1];
      const expectedScore = args[2] ? parseFloat(args[2]) : undefined;
      
      await tester.runSpecificSearchTest(filePath, searchQuery, expectedScore);
    } else {
      // Run all predefined test cases
      const allResults = [];
      
      // Run generated content tests
      if (TEST_CASES.length > 0) {
        console.log('📋 Running generated content tests...');
        await tester.indexFiles(testFilesDir, TEST_CASES);
        const results = await tester.runSearchTests(TEST_CASES);
        allResults.push(...results);
      }
      
      // Run file-based tests
      if (FILE_TEST_CASES.length > 0) {
        console.log('📋 Running file-based tests...');
        await tester.indexExistingFiles(testFilesDir, FILE_TEST_CASES);
        const fileResults = await tester.runFileSearchTests(FILE_TEST_CASES);
        allResults.push(...fileResults);
      }
      
      // Summary
      console.log('📈 Test Summary:');
      const passed = allResults.filter(r => r.passed).length;
      const failed = allResults.filter(r => !r.passed).length;
      console.log(`   Passed: ${passed}/${allResults.length}`);
      console.log(`   Failed: ${failed}/${allResults.length}`);
      
      if (failed > 0) {
        process.exit(1);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await tester.cleanup();
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}