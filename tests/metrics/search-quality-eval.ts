#!/usr/bin/env npx tsx

/**
 * Search Quality Evaluation Script
 *
 * Comprehensive quality testing for embedding-based search using real Python sidecar
 * and production model (paraphrase-multilingual-mpnet-base-v2, 768-dim).
 *
 * Features:
 * - Standard IR metrics: Precision@K, Recall@K, Mean Reciprocal Rank (MRR)
 * - 25 test cases across 6 categories (exact match, semantic, paraphrase, cross-lingual, etc.)
 * - Category-specific analysis
 * - Score distribution analysis
 * - Automated quality thresholds (P@1 >= 70%, P@3 >= 85%)
 *
 * Usage:
 *   # Run full quality evaluation (default)
 *   npx tsx tests/metrics/search-quality-eval.ts
 *
 *   # Show detailed per-query results
 *   npx tsx tests/metrics/search-quality-eval.ts --detailed
 *
 *   # Export results to JSON
 *   npx tsx tests/metrics/search-quality-eval.ts --export
 *
 *   # Test specific file (ad-hoc testing)
 *   npx tsx tests/metrics/search-quality-eval.ts "/path/to/file.pdf" "search query" [expectedScore]
 *
 *   # Legacy test mode (old pass/fail format)
 *   npx tsx tests/metrics/search-quality-eval.ts --legacy
 *
 * Requirements:
 * - Built worker: npm run build
 * - Python sidecar models (auto-copied from Semantica if available)
 *
 * Test Categories:
 * 1. Exact Match (5 tests) - Direct text matches
 * 2. Semantic Similarity (5 tests) - Synonyms and related concepts
 * 3. Paraphrases (5 tests) - Same meaning, different words
 * 4. Cross-lingual (3 tests) - French ↔ English queries
 * 5. Multi-word Concepts (4 tests) - Complex phrases
 * 6. Edge Cases (3 tests) - Short queries, acronyms, numbers
 */

import { Worker } from 'node:worker_threads';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { QualityMetrics, QueryEvaluation } from './quality-metrics';

interface TestCase {
  name: string;
  category: string; // Test category for grouping
  fileContent: string;
  fileName: string;
  searchQuery: string;
  expectedMinScore: number; // Minimum similarity score expected (0-1)
  expectedMaxScore?: number; // Optional maximum score for range testing
}

interface TestCaseWithFile {
  name: string;
  category: string; // Test category for grouping
  filePath: string; // Path to existing file to copy
  searchQuery: string;
  expectedMinScore: number;
  expectedMaxScore?: number;
}

// Define your test cases here - comprehensive quality evaluation suite
const TEST_CASES: TestCase[] = [
  // Category 1: Exact Match (5 cases) - Query text appears verbatim in document
  {
    name: "Exact phrase match",
    category: "exact-match",
    fileName: "exact-01.txt",
    fileContent: "The quick brown fox jumps over the lazy dog. This is a test document for search accuracy.",
    searchQuery: "quick brown fox",
    expectedMinScore: 0.8
  },
  {
    name: "Exact sentence match",
    category: "exact-match",
    fileName: "exact-02.txt",
    fileContent: "Climate change is one of the most pressing issues of our time. The global temperature has risen by 1.1 degrees Celsius since pre-industrial times.",
    searchQuery: "climate change pressing issue",
    expectedMinScore: 0.75
  },
  {
    name: "Technical term exact match",
    category: "exact-match",
    fileName: "exact-03.txt",
    fileContent: "Quantum entanglement is a physical phenomenon that occurs when pairs of particles interact in ways such that the quantum state of each particle cannot be described independently.",
    searchQuery: "quantum entanglement",
    expectedMinScore: 0.85
  },
  {
    name: "Name exact match",
    category: "exact-match",
    fileName: "exact-04.txt",
    fileContent: "Albert Einstein developed the theory of relativity. His work on the photoelectric effect earned him the Nobel Prize in Physics in 1921.",
    searchQuery: "Albert Einstein",
    expectedMinScore: 0.85
  },
  {
    name: "Date and event exact match",
    category: "exact-match",
    fileName: "exact-05.txt",
    fileContent: "World War II ended in 1945 with the surrender of Germany in May and Japan in August. The war resulted in significant geopolitical changes.",
    searchQuery: "World War II 1945",
    expectedMinScore: 0.8
  },

  // Category 2: Semantic Similarity (5 cases) - Synonyms and related concepts
  {
    name: "Synonym: car vs automobile",
    category: "semantic",
    fileName: "semantic-01.txt",
    fileContent: "The automobile industry has undergone significant transformations in recent decades. Electric vehicles are becoming increasingly popular.",
    searchQuery: "car industry changes",
    expectedMinScore: 0.6
  },
  {
    name: "Synonym: happy vs joyful",
    category: "semantic",
    fileName: "semantic-02.txt",
    fileContent: "The children were joyful when they saw the snow falling. Their excitement was contagious throughout the neighborhood.",
    searchQuery: "happy children snow",
    expectedMinScore: 0.6
  },
  {
    name: "Related concept: doctor vs physician",
    category: "semantic",
    fileName: "semantic-03.txt",
    fileContent: "The physician examined the patient thoroughly and prescribed appropriate medication. Medical care has improved significantly over the years.",
    searchQuery: "doctor examined patient",
    expectedMinScore: 0.65
  },
  {
    name: "Related concept: computer vs technology",
    category: "semantic",
    fileName: "semantic-04.txt",
    fileContent: "Modern technology has revolutionized how we communicate and work. Digital tools enable remote collaboration across continents.",
    searchQuery: "computers changed communication",
    expectedMinScore: 0.6
  },
  {
    name: "Hypernym: animal vs dog",
    category: "semantic",
    fileName: "semantic-05.txt",
    fileContent: "Dogs are loyal companions and have been domesticated for thousands of years. They provide emotional support and assistance to humans.",
    searchQuery: "animals as companions",
    expectedMinScore: 0.55
  },

  // Category 3: Paraphrases (5 cases) - Same meaning, different words
  {
    name: "Paraphrase: buy vs purchase",
    category: "paraphrase",
    fileName: "paraphrase-01.txt",
    fileContent: "You can purchase tickets online through our website or at the box office. Payment methods include credit cards and cash.",
    searchQuery: "buy tickets online",
    expectedMinScore: 0.65
  },
  {
    name: "Paraphrase: help vs assist",
    category: "paraphrase",
    fileName: "paraphrase-02.txt",
    fileContent: "Our customer service team is available to assist you with any questions or concerns. We provide support 24/7.",
    searchQuery: "help with questions",
    expectedMinScore: 0.65
  },
  {
    name: "Paraphrase: begin vs start",
    category: "paraphrase",
    fileName: "paraphrase-03.txt",
    fileContent: "The meeting will commence at 9 AM sharp. Please arrive early to ensure a prompt start.",
    searchQuery: "meeting begins 9 AM",
    expectedMinScore: 0.6
  },
  {
    name: "Paraphrase: quick vs fast",
    category: "paraphrase",
    fileName: "paraphrase-04.txt",
    fileContent: "The rapid development of artificial intelligence has surprised many experts. The pace of innovation continues to accelerate.",
    searchQuery: "fast AI development",
    expectedMinScore: 0.65
  },
  {
    name: "Paraphrase: large vs big",
    category: "paraphrase",
    fileName: "paraphrase-05.txt",
    fileContent: "The massive corporation employs over 100,000 people worldwide. It has operations in more than 50 countries.",
    searchQuery: "big company employees",
    expectedMinScore: 0.6
  },

  // Category 4: Cross-lingual (3 cases) - French and English
  {
    name: "Cross-lingual: English query, French document",
    category: "cross-lingual",
    fileName: "cross-lingual-01.txt",
    fileContent: "La technologie moderne a transformé notre façon de vivre et de travailler. L'intelligence artificielle devient de plus en plus importante dans notre vie quotidienne.",
    searchQuery: "modern technology transforms life",
    expectedMinScore: 0.60
  },
  {
    name: "Cross-lingual: French query, English document",
    category: "cross-lingual",
    fileName: "cross-lingual-02.txt",
    fileContent: "Environmental protection is crucial for future generations. We must take action now to preserve our planet and its natural resources.",
    searchQuery: "protection de l'environnement pour les générations futures",
    expectedMinScore: 0.60
  },
  {
    name: "Cross-lingual: Mixed language document",
    category: "cross-lingual",
    fileName: "cross-lingual-03.txt",
    fileContent: "Le restaurant offers authentic French cuisine with a modern twist. Our chef combines traditional recipes avec des techniques contemporaines.",
    searchQuery: "French restaurant modern cooking",
    expectedMinScore: 0.6
  },

  // Category 5: Multi-word Concepts (4 cases) - Complex phrases
  {
    name: "Multi-word: machine learning",
    category: "multi-word",
    fileName: "multi-word-01.txt",
    fileContent: "Machine learning algorithms can analyze large datasets and identify patterns that humans might miss. These techniques are used in various applications from healthcare to finance.",
    searchQuery: "machine learning patterns data",
    expectedMinScore: 0.7
  },
  {
    name: "Multi-word: renewable energy",
    category: "multi-word",
    fileName: "multi-word-02.txt",
    fileContent: "Renewable energy sources like solar and wind power are becoming more cost-effective. They offer sustainable alternatives to fossil fuels.",
    searchQuery: "renewable energy solar wind",
    expectedMinScore: 0.75
  },
  {
    name: "Multi-word: supply chain management",
    category: "multi-word",
    fileName: "multi-word-03.txt",
    fileContent: "Effective supply chain management is critical for business success. Companies must optimize logistics, inventory, and distribution to remain competitive.",
    searchQuery: "supply chain logistics optimization",
    expectedMinScore: 0.7
  },
  {
    name: "Multi-word: remote work productivity",
    category: "multi-word",
    fileName: "multi-word-04.txt",
    fileContent: "Remote work has become increasingly common since the pandemic. Studies show that productivity can be maintained or even improved when employees work from home.",
    searchQuery: "remote work productivity improvement",
    expectedMinScore: 0.75
  },

  // Category 6: Edge Cases (3 cases) - Challenging scenarios
  {
    name: "Edge case: short query",
    category: "edge-case",
    fileName: "edge-case-01.txt",
    fileContent: "Python is a versatile programming language used for web development, data analysis, artificial intelligence, and scientific computing. Its simple syntax makes it popular among beginners.",
    searchQuery: "Python",
    expectedMinScore: 0.7
  },
  {
    name: "Edge case: acronym",
    category: "edge-case",
    fileName: "edge-case-02.txt",
    fileContent: "The World Health Organization (WHO) coordinates international health initiatives and responds to global health emergencies. It was founded in 1948.",
    searchQuery: "WHO global health",
    expectedMinScore: 0.65
  },
  {
    name: "Edge case: numerical query",
    category: "edge-case",
    fileName: "edge-case-03.txt",
    fileContent: "The speed of light in vacuum is approximately 299,792,458 meters per second. This fundamental constant plays a crucial role in physics.",
    searchQuery: "speed of light 299792458",
    expectedMinScore: 0.7
  },
];

// Test cases that use existing files
const FILE_TEST_CASES: TestCaseWithFile[] = [
  {
    name: "French legal document - Résiliation bail Neuchâtel",
    category: "real-file",
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
    const workerPath = path.join(__dirname, '../../dist/worker.cjs');
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
      // Log stage messages for debugging
      if (msg.stage) {
        console.log(`[WORKER] ${msg.stage}: ${msg.message || ''}`);
      }

      // Worker sends 'files:loaded' when fully initialized
      if (msg.type === 'files:loaded') {
        this.workerReady = true;
        console.log('[TEST] ✅ Worker is ready');
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
    const maxWait = 120000; // 120 seconds (Python sidecar + model loading can take time)
    const startTime = Date.now();

    console.log('[TEST] Waiting for worker initialization...');
    while (!this.workerReady) {
      if (Date.now() - startTime > maxWait) {
        throw new Error('Worker initialization timeout after 120 seconds');
      }
      await new Promise(resolve => setTimeout(resolve, 500));

      // Show progress every 10 seconds
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed > 0 && elapsed % 10 === 0) {
        console.log(`[TEST] Still waiting... (${elapsed}s elapsed)`);
      }
    }

    console.log('[TEST] Worker initialization complete');
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
  
  async runQualityEvaluation(testCases: TestCase[]): Promise<QueryEvaluation[]> {
    console.log('\n🎯 Running Quality Evaluation...\n');

    const evaluations: QueryEvaluation[] = [];

    for (const testCase of testCases) {
      try {
        const searchResults = await this.sendMessage('search', {
          q: testCase.searchQuery,
          k: 10
        });

        // Convert to QueryEvaluation format
        const results = searchResults.map((r: any, idx: number) => ({
          path: path.basename(r.path),
          score: r.score,
          rank: idx + 1
        }));

        const relevantDocs = new Set([testCase.fileName]);

        evaluations.push({
          query: testCase.searchQuery,
          results,
          relevantDocs
        });

        // Show progress
        const fileResult = searchResults.find((r: any) =>
          path.basename(r.path) === testCase.fileName
        );
        const found = fileResult ? '✓' : '✗';
        const score = fileResult ? `${(fileResult.score * 100).toFixed(0)}%` : 'N/A';
        console.log(`   ${found} [${testCase.category}] ${testCase.name} (score: ${score})`);

      } catch (error) {
        console.log(`   ✗ [${testCase.category}] ${testCase.name} - ERROR: ${error}`);
        // Add empty evaluation for failed queries
        evaluations.push({
          query: testCase.searchQuery,
          results: [],
          relevantDocs: new Set([testCase.fileName])
        });
      }
    }

    return evaluations;
  }

  async runCategoryBreakdown(testCases: TestCase[], evaluations: QueryEvaluation[]) {
    console.log('\n📂 CATEGORY BREAKDOWN');
    console.log('───────────────────────────────────────────────────────────');

    // Group by category
    const categories = new Map<string, TestCase[]>();
    testCases.forEach(tc => {
      if (!categories.has(tc.category)) {
        categories.set(tc.category, []);
      }
      categories.get(tc.category)!.push(tc);
    });

    // Calculate metrics per category
    for (const [category, cases] of categories) {
      const categoryEvals = evaluations.filter(e =>
        cases.some(tc => tc.searchQuery === e.query)
      );

      if (categoryEvals.length === 0) continue;

      const report = QualityMetrics.generateReport(categoryEvals);
      const passed = categoryEvals.filter(e => {
        const topResult = e.results[0];
        return topResult && e.relevantDocs.has(topResult.path);
      }).length;

      console.log(`\n${category.toUpperCase()} (${cases.length} tests)`);
      console.log(`   Success Rate: ${passed}/${cases.length} (${((passed/cases.length)*100).toFixed(0)}%)`);
      console.log(`   Precision@1:  ${(report.precisionAt1 * 100).toFixed(1)}%`);
      console.log(`   Precision@3:  ${(report.precisionAt3 * 100).toFixed(1)}%`);
      console.log(`   MRR:          ${report.mrr.toFixed(3)}`);
    }

    console.log('');
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
    console.log('🚀 Starting Search Quality Evaluation\n');
    console.log('   Using REAL Python sidecar and production model');
    console.log('   Model: paraphrase-multilingual-mpnet-base-v2 (768-dim)\n');

    const testFilesDir = await tester.setup();

    // Check for command line arguments
    const args = process.argv.slice(2);

    // Check for --legacy flag for old test mode
    if (args.includes('--legacy')) {
      console.log('Running in legacy test mode...\n');
      const allResults = [];

      if (TEST_CASES.length > 0) {
        console.log('📋 Running generated content tests...');
        await tester.indexFiles(testFilesDir, TEST_CASES);
        const results = await tester.runSearchTests(TEST_CASES);
        allResults.push(...results);
      }

      if (FILE_TEST_CASES.length > 0) {
        console.log('📋 Running file-based tests...');
        await tester.indexExistingFiles(testFilesDir, FILE_TEST_CASES);
        const fileResults = await tester.runFileSearchTests(FILE_TEST_CASES);
        allResults.push(...fileResults);
      }

      console.log('📈 Test Summary:');
      const passed = allResults.filter(r => r.passed).length;
      const failed = allResults.filter(r => !r.passed).length;
      console.log(`   Passed: ${passed}/${allResults.length}`);
      console.log(`   Failed: ${failed}/${allResults.length}`);

      if (failed > 0) {
        process.exit(1);
      }
    } else if (args.length >= 2 && !args[0].startsWith('--')) {
      // Specific file test mode
      const filePath = args[0];
      const searchQuery = args[1];
      const expectedScore = args[2] ? parseFloat(args[2]) : undefined;

      await tester.runSpecificSearchTest(filePath, searchQuery, expectedScore);
    } else {
      // NEW: Quality Evaluation Mode (default)
      console.log('📋 Indexing test documents...');
      await tester.indexFiles(testFilesDir, TEST_CASES);

      // Run quality evaluation
      const evaluations = await tester.runQualityEvaluation(TEST_CASES);

      // Generate comprehensive metrics report
      const report = QualityMetrics.generateReport(evaluations);

      // Display formatted report
      console.log(QualityMetrics.formatReport(report, false)); // Brief mode for overview

      // Show category breakdown
      await tester.runCategoryBreakdown(TEST_CASES, evaluations);

      // Optional: Show detailed per-query results if --detailed flag is provided
      if (args.includes('--detailed')) {
        console.log('\n' + QualityMetrics.formatReport(report, true));
      } else {
        console.log('💡 Tip: Run with --detailed flag to see per-query results');
      }

      // Optional: Export results to JSON
      if (args.includes('--export')) {
        const exportPath = path.join(testFilesDir, 'quality-report.json');
        fs.writeFileSync(exportPath, JSON.stringify(report, null, 2));
        console.log(`\n📄 Report exported to: ${exportPath}`);
      }

      // Exit with error if quality is below acceptable threshold
      // Based on documented expectations: Top-1 >= 70%, Top-3 >= 85%
      if (report.precisionAt1 < 0.70 || report.precisionAt3 < 0.85) {
        console.log('\n⚠️  WARNING: Search quality is below expected thresholds');
        console.log(`   Expected: P@1 >= 70%, P@3 >= 85%`);
        console.log(`   Actual:   P@1 = ${(report.precisionAt1 * 100).toFixed(1)}%, P@3 = ${(report.precisionAt3 * 100).toFixed(1)}%`);
        process.exit(1);
      }
    }

  } catch (error) {
    console.error('❌ Evaluation failed:', error);
    process.exit(1);
  } finally {
    await tester.cleanup();
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}