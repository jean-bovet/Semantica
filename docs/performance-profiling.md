# Performance Profiling Guide

This guide explains how to measure and analyze performance bottlenecks in FSS/Semantica's indexing pipeline.

## Quick Start

1. **Enable profiling by setting environment variable:**
   ```bash
   PROFILE=true npm run dev
   ```

2. **Index some files normally**

3. **Stop the app (Ctrl+C) to generate report**

4. **Find report in home directory:**
   ```bash
   ls ~/fss-performance-*.json
   ```

## What Gets Measured

The profiler tracks detailed metrics for each stage of file processing:

### Per-File Metrics
- **Hash Check**: Time to compute file hash and check if changed
- **Status Check**: Database lookup for existing file status  
- **Parsing**: Time to extract text from files (PDF, DOCX, etc.)
- **Chunking**: Time to split text into chunks
- **Embedding**: Time to generate vector embeddings
- **DB Write**: Time to write chunks to LanceDB

### System Metrics
- **Concurrency**: Number of files processed in parallel
- **Memory Usage**: RSS, heap, external memory over time
- **Embedder Restarts**: How often the child process restarts
- **Throttling**: When and how long processing was throttled
- **Database Conflicts**: Write conflicts and retries

## Using the Performance Script

A dedicated script provides advanced profiling capabilities:

```bash
# Install script dependencies
cd scripts
npm install

# Profile with test files
npm run profile -- --folder ~/TestDocs --files 100

# Analyze existing report
npm run profile -- --analyze

# Generate report to specific location  
npm run profile -- --output ~/Desktop/profile.json
```

## Integrating Profiling into Worker

To add profiling to the existing worker:

1. **Import the profiler:**
   ```typescript
   import { profiler } from './PerformanceProfiler';
   ```

2. **Wrap operations with timing calls:**
   ```typescript
   // Time synchronous operations
   const result = profiler.timeFileOperation(filePath, 'parsing', () => {
     return parseFile(filePath);
   });

   // Time async operations
   const vectors = await profiler.timeFileOperationAsync(
     filePath, 'embedding', 
     async () => await embed(texts)
   );
   ```

3. **Track key events:**
   ```typescript
   // Record embedder restart
   profiler.recordEmbedderRestart();
   
   // Record throttling
   if (memoryHigh) {
     profiler.recordThrottleStart();
   }
   ```

4. **Generate report on shutdown:**
   ```typescript
   process.on('SIGINT', async () => {
     await profiler.saveReport();
     process.exit(0);
   });
   ```

## Understanding the Report

The report includes:

### Summary Section
```
📁 Files Processed: 245/250
⏱️  Total Time: 125.3s
⚡ Avg File Time: 0.51s
🔄 Max Concurrency: 7

📊 Operation Breakdown:
  embedding    ████████████████████ 42.3% (0.22s avg)
  parsing      ███████████ 23.1% (0.12s avg)
  dbWrite      ██████ 12.4% (0.06s avg)
```

### Bottleneck Analysis
Identifies the slowest operations and provides specific recommendations:
- **Embedding > 40%**: Consider batch size optimization, GPU acceleration
- **Parsing > 30%**: Implement streaming parsers, caching
- **DB Writes > 20%**: Increase batch sizes, async writes
- **Embedder Restarts > 5**: Increase restart thresholds

### File Type Performance
Shows performance by file extension to identify problematic formats:
```
.pdf: 45 files, avg 1.23s, avg size 245KB
.txt: 120 files, avg 0.34s, avg size 12KB
.docx: 85 files, avg 0.67s, avg size 89KB
```

## Optimization Workflow

1. **Baseline Measurement**
   - Run profiler on representative dataset
   - Save baseline report

2. **Identify Bottlenecks**
   - Look at operation breakdown
   - Check bottleneck recommendations
   - Review memory/restart patterns

3. **Apply Optimizations**
   - Focus on highest-impact operations
   - Implement recommended changes

4. **Measure Improvement**
   - Re-run profiler on same dataset
   - Compare with baseline
   - Verify improvements

## Example Analysis

Here's how to interpret common patterns:

### Pattern 1: Embedding Bottleneck
```
embedding: 52% of total time
Recommendation: Embedding is the bottleneck
```
**Solution**: 
- Increase batch size from 8 to 16
- Process multiple batches in parallel
- Cache frequently seen text patterns

### Pattern 2: Excessive Restarts
```
Embedder restarts: 23
Restart overhead: 45s per restart
```
**Solution**:
- Increase `maxFilesBeforeRestart` to 5000
- Increase `maxMemoryMB` to 2000
- Implement idle-time restarts

### Pattern 3: Memory Throttling
```
Throttle events: 15
Time throttled: 23%
```
**Solution**:
- Increase memory threshold
- Optimize memory usage in parsers
- Implement streaming for large files

## Performance Targets

Based on analysis, here are realistic performance targets:

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| Files/second | 2-3 | 5-8 | 2-3x |
| Avg file time | 0.5s | 0.2s | 2.5x |
| Embedder restarts/1000 files | 2 | 0.2 | 10x |
| Time throttled | 20% | 5% | 4x |

## Continuous Monitoring

For production monitoring:

1. **Enable lightweight profiling:**
   ```typescript
   const profiler = new PerformanceProfiler(
     process.env.NODE_ENV === 'production' ? 'light' : 'full'
   );
   ```

2. **Set up periodic reports:**
   ```typescript
   setInterval(() => {
     if (profiler.isEnabled()) {
       profiler.saveReport(`profile-${Date.now()}.json`);
       profiler.reset();
     }
   }, 3600000); // Every hour
   ```

3. **Monitor key metrics:**
   - Files indexed per minute
   - Average processing time
   - Memory usage trends
   - Error rates by file type

## Troubleshooting

### No report generated
- Ensure `PROFILE=true` is set
- Check app closed properly (not killed)
- Look in home directory for reports

### Missing operations in report
- Verify instrumentation added to code
- Check profiler.enabled is true
- Ensure operations complete before report

### Inaccurate timings
- Run with single folder to reduce noise
- Use consistent test dataset
- Disable other apps during profiling

## Next Steps

1. Run profiling on your actual document set
2. Identify your specific bottlenecks
3. Apply targeted optimizations
4. Measure improvements
5. Share results for further optimization ideas