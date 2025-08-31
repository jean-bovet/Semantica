#!/usr/bin/env node

/**
 * Performance Profiling Script for FSS/Semantica
 * 
 * Usage:
 *   npm run profile -- --folder /path/to/test/folder --files 100
 *   npm run profile -- --analyze
 * 
 * This script enables performance profiling and generates detailed reports
 * to identify actual bottlenecks in the indexing pipeline.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

interface ProfileOptions {
  testFolder?: string;
  fileCount?: number;
  analyzeOnly?: boolean;
  outputPath?: string;
}

function parseArgs(): ProfileOptions {
  const args = process.argv.slice(2);
  const options: ProfileOptions = {};
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--folder':
        options.testFolder = args[++i];
        break;
      case '--files':
        options.fileCount = parseInt(args[++i]);
        break;
      case '--analyze':
        options.analyzeOnly = true;
        break;
      case '--output':
        options.outputPath = args[++i];
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }
  
  return options;
}

function printHelp() {
  console.log(`
FSS Performance Profiler

Usage:
  npm run profile -- [options]

Options:
  --folder <path>   Folder to index for profiling
  --files <number>  Number of test files to process (default: all)
  --analyze         Analyze existing profile data only
  --output <path>   Output path for the report
  --help           Show this help message

Examples:
  # Profile indexing of a specific folder
  npm run profile -- --folder ~/Documents --files 100
  
  # Analyze existing profile data
  npm run profile -- --analyze
  
  # Generate report to specific location
  npm run profile -- --folder ~/Test --output ~/Desktop/profile.json

Environment Variables:
  PROFILE=true     Enable profiling (set automatically by this script)
  PROFILE_MEMORY=true  Enable detailed memory profiling
`);
}

async function createTestFiles(folder: string, count: number) {
  console.log(`Creating ${count} test files in ${folder}...`);
  
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  
  // Create a mix of file types for realistic testing
  const fileTypes = [
    { ext: 'txt', content: () => generateTextContent() },
    { ext: 'md', content: () => generateMarkdownContent() },
    { ext: 'pdf', content: () => null }, // Skip PDF for now
  ];
  
  for (let i = 0; i < count; i++) {
    const type = fileTypes[i % fileTypes.length];
    if (type.content()) {
      const fileName = `test-file-${i + 1}.${type.ext}`;
      const filePath = path.join(folder, fileName);
      const content = type.content();
      if (content) {
        fs.writeFileSync(filePath, content);
      }
    }
  }
  
  console.log(`Created ${count} test files`);
}

function generateTextContent(): string {
  const paragraphs = [];
  const paragraphCount = Math.floor(Math.random() * 20) + 10;
  
  for (let i = 0; i < paragraphCount; i++) {
    const sentences = [];
    const sentenceCount = Math.floor(Math.random() * 10) + 5;
    
    for (let j = 0; j < sentenceCount; j++) {
      sentences.push(generateSentence());
    }
    
    paragraphs.push(sentences.join(' '));
  }
  
  return paragraphs.join('\n\n');
}

function generateMarkdownContent(): string {
  const sections = [];
  const sectionCount = Math.floor(Math.random() * 5) + 3;
  
  sections.push(`# Document ${Date.now()}`);
  
  for (let i = 0; i < sectionCount; i++) {
    sections.push(`\n## Section ${i + 1}\n`);
    sections.push(generateTextContent());
  }
  
  return sections.join('\n');
}

function generateSentence(): string {
  const words = [
    'The', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog',
    'Lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing',
    'Machine', 'learning', 'algorithm', 'processes', 'data', 'efficiently',
    'Performance', 'optimization', 'requires', 'careful', 'analysis'
  ];
  
  const length = Math.floor(Math.random() * 10) + 5;
  const sentence = [];
  
  for (let i = 0; i < length; i++) {
    sentence.push(words[Math.floor(Math.random() * words.length)]);
  }
  
  return sentence.join(' ') + '.';
}

async function runProfiler(options: ProfileOptions) {
  console.log('Starting FSS with performance profiling enabled...');
  
  // Set environment variables
  const env = {
    ...process.env,
    PROFILE: 'true',
    PROFILE_MEMORY: 'true'
  };
  
  // Start the application with profiling enabled
  const appProcess = spawn('npm', ['run', 'dev'], {
    env,
    stdio: 'inherit'
  });
  
  // Wait for indexing to complete (monitor logs or use IPC)
  console.log('\nApplication started with profiling enabled.');
  console.log('Index files and then press Ctrl+C to generate the report.\n');
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nGenerating performance report...');
    
    // Send message to generate report (would need IPC implementation)
    // For now, the report will be generated on shutdown
    
    appProcess.kill('SIGINT');
    
    // Wait for report generation
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Find and display the report
    const reportFiles = fs.readdirSync(process.env.HOME || '.')
      .filter(f => f.startsWith('fss-performance-'))
      .sort()
      .reverse();
    
    if (reportFiles.length > 0) {
      const latestReport = path.join(process.env.HOME || '.', reportFiles[0]);
      console.log(`\nReport generated: ${latestReport}`);
      
      // Display summary
      const report = JSON.parse(fs.readFileSync(latestReport, 'utf-8'));
      console.log(report.summary);
    }
    
    process.exit(0);
  });
}

async function analyzeReport(reportPath?: string) {
  // Find the latest report if not specified
  if (!reportPath) {
    const reportFiles = fs.readdirSync(process.env.HOME || '.')
      .filter(f => f.startsWith('fss-performance-'))
      .sort()
      .reverse();
    
    if (reportFiles.length === 0) {
      console.error('No performance reports found. Run profiling first.');
      process.exit(1);
    }
    
    reportPath = path.join(process.env.HOME || '.', reportFiles[0]);
  }
  
  console.log(`Analyzing report: ${reportPath}\n`);
  
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  const metrics = report.metrics;
  
  // Detailed analysis
  console.log('═══════════════════════════════════════════════════════');
  console.log('           DETAILED PERFORMANCE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════');
  
  // Throughput analysis
  const throughput = metrics.totalFiles / (metrics.totalDuration / 1000);
  console.log('\n📈 THROUGHPUT METRICS:');
  console.log(`  Files/second: ${throughput.toFixed(2)}`);
  console.log(`  Avg time/file: ${(metrics.averageFileTime / 1000).toFixed(2)}s`);
  
  // Concurrency analysis
  console.log('\n🔄 CONCURRENCY ANALYSIS:');
  console.log(`  Max concurrent: ${metrics.concurrency.maxConcurrent}`);
  console.log(`  Throttle events: ${metrics.concurrency.throttleEvents}`);
  if (metrics.concurrency.throttleEvents > 0) {
    const throttlePercent = (metrics.concurrency.throttleDuration / metrics.totalDuration) * 100;
    console.log(`  Time throttled: ${throttlePercent.toFixed(1)}%`);
  }
  
  // Operation breakdown with visual bars
  console.log('\n⏱️  OPERATION BREAKDOWN:');
  const sortedOps = Object.entries(metrics.operations)
    .sort((a, b) => (b[1] as any).totalTime - (a[1] as any).totalTime);
  
  for (const [name, stats] of sortedOps) {
    const s = stats as any;
    const bar = '█'.repeat(Math.round(s.percentOfTotal / 2));
    const spaces = ' '.repeat(25 - bar.length);
    console.log(`  ${name.padEnd(12)} ${bar}${spaces} ${s.percentOfTotal.toFixed(1)}%`);
    console.log(`               Avg: ${(s.avgTime / 1000).toFixed(3)}s, Min: ${(s.minTime / 1000).toFixed(3)}s, Max: ${(s.maxTime / 1000).toFixed(3)}s`);
  }
  
  // Memory analysis
  console.log('\n💾 MEMORY ANALYSIS:');
  console.log(`  Peak RSS: ${(metrics.memory.peakRSS / 1024 / 1024).toFixed(0)}MB`);
  console.log(`  Avg RSS: ${(metrics.memory.avgRSS / 1024 / 1024).toFixed(0)}MB`);
  console.log(`  Embedder restarts: ${metrics.memory.embedderRestarts}`);
  if (metrics.memory.embedderRestarts > 0) {
    const restartOverhead = (metrics.memory.embedderRestarts * 60) / (metrics.totalDuration / 1000);
    console.log(`  Restart overhead: ${restartOverhead.toFixed(1)}s per restart`);
  }
  
  // File type performance
  console.log('\n📁 FILE TYPE PERFORMANCE:');
  for (const [ext, stats] of Object.entries(metrics.fileTypes)) {
    const s = stats as any;
    console.log(`  .${ext}: ${s.count} files, avg ${(s.avgTime / 1000).toFixed(2)}s, avg size ${(s.avgSize / 1024).toFixed(1)}KB`);
  }
  
  // Bottleneck recommendations
  if (metrics.bottlenecks.length > 0) {
    console.log('\n🚨 BOTTLENECK ANALYSIS:');
    for (const bottleneck of metrics.bottlenecks) {
      console.log(`\n  ${bottleneck.operation.toUpperCase()} (${bottleneck.impact.toFixed(1)}% impact)`);
      console.log(`  └─ ${bottleneck.recommendation}`);
    }
  }
  
  // Calculate and show optimization potential
  console.log('\n🎯 OPTIMIZATION POTENTIAL:');
  
  // Calculate potential improvements
  const embedTime = metrics.operations.embedding?.totalTime || 0;
  const parseTime = metrics.operations.parsing?.totalTime || 0;
  const dbTime = metrics.operations.dbWrite?.totalTime || 0;
  
  if (embedTime > 0) {
    const parallelEmbedGain = embedTime * 0.3; // 30% improvement with parallel embedding
    console.log(`  Parallel embedding: Save ~${(parallelEmbedGain / 1000).toFixed(1)}s`);
  }
  
  if (metrics.memory.embedderRestarts > 5) {
    const restartTime = metrics.memory.embedderRestarts * 60000;
    console.log(`  Reduce restarts: Save ~${(restartTime / 1000).toFixed(1)}s`);
  }
  
  if (dbTime > 0) {
    const batchWriteGain = dbTime * 0.2; // 20% improvement with better batching
    console.log(`  Batch DB writes: Save ~${(batchWriteGain / 1000).toFixed(1)}s`);
  }
  
  console.log('\n═══════════════════════════════════════════════════════');
}

// Main execution
async function main() {
  const options = parseArgs();
  
  if (options.analyzeOnly) {
    await analyzeReport(options.outputPath);
  } else {
    // Create test files if requested
    if (options.testFolder && options.fileCount) {
      await createTestFiles(options.testFolder, options.fileCount);
    }
    
    // Run profiler
    await runProfiler(options);
  }
}

main().catch(console.error);