# Memory Leak Investigation Report

## Executive Summary
The offline Mac search application was experiencing severe memory leaks causing crashes during file indexing. Memory usage would spike from ~200MB to over 1.2GB after processing just 20 files, leading to process termination.

## Investigation Process

### 1. Initial Symptoms
- App crashes with exit code `null` during indexing
- No useful error messages in console
- Crashes occurred randomly but frequently

### 2. Crash Reporter Implementation
Added Electron crash reporter to capture native crashes:
```javascript
crashReporter.start({
  productName: 'offline-mac-search',
  companyName: 'YourOrg',
  submitURL: '',
  uploadToServer: false,
  ignoreSystemCrashHandler: false,
  rateLimit: false,
  compress: true
});
```

**Finding**: Crashes were due to `libc++abi: terminating due to uncaught exception of type Napi::Error`

### 3. Memory Monitoring Implementation
Added detailed memory tracking in worker process:
```javascript
setInterval(() => {
  const usage = process.memoryUsage();
  console.log(`Memory: RSS=${Math.round(usage.rss / 1024 / 1024)}MB, ` +
    `Heap=${Math.round(usage.heapUsed / 1024 / 1024)}MB/` +
    `${Math.round(usage.heapTotal / 1024 / 1024)}MB, ` +
    `External=${Math.round(usage.external / 1024 / 1024)}MB, ` +
    `Files processed: ${fileCount}`);
}, 2000);
```

### 4. Memory Usage Patterns Discovered

#### Baseline (No Files Watched)
- RSS: ~200MB
- Heap: ~11MB
- External: ~3MB

#### File Watching Only (No Indexing)
- RSS: ~240MB (stable)
- Heap: ~15MB
- External: ~4MB
- **Conclusion**: File watching (Chokidar) is not the issue

#### With Indexing Enabled
- **Initial spike**: RSS jumps to 392MB after first file
- **External memory spike**: 3MB → 51MB (17x increase!)
- **Continuous growth**: 
  - After 7 files: 887MB
  - After 20 files: 1,202MB
  - After 25 files: Process crashes

## Root Cause Analysis

### Primary Culprit: Transformers.js Embedding Model

The memory leak originates from the `@xenova/transformers` library used for generating text embeddings:

1. **Model Loading**: Initial 200MB memory spike when loading `Xenova/all-MiniLM-L6-v2`
2. **Tensor Accumulation**: Output tensors from the model are not properly disposed
3. **Native Memory Leak**: External memory (native buffers) grows continuously

### Code Analysis

The embedding function was missing tensor disposal:
```javascript
// BEFORE (Leaking)
const output = await pipe(texts, {
  pooling: 'mean',
  normalize: true
});
const data = output.data as Float32Array;
// ... use data ...
return vectors; // output tensor never disposed!
```

## Fixes Implemented

### 1. Tensor Disposal
```javascript
export async function embed(texts: string[]): Promise<number[][]> {
  let output: any = null;
  try {
    const pipe = await getEmbedder();
    output = await pipe(texts, {
      pooling: 'mean',
      normalize: true
    });
    // ... process data ...
    return vectors;
  } finally {
    // Dispose of the output tensor to free memory
    if (output && typeof output.dispose === 'function') {
      output.dispose();
    }
  }
}
```

### 2. Aggressive Memory Cleanup
```javascript
// After processing each file
chunks = null as any;

// After each batch
batch.length = 0;
texts.length = 0;
vectors.length = 0;
rows.length = 0;

// Force garbage collection if available
if (global.gc) {
  global.gc();
}
```

### 3. Reduced Batch Size
- Changed from 32 to 16 chunks per batch
- Reduces peak memory usage during processing

### 4. Disabled PDF Processing by Default
- PDF files were particularly memory-intensive
- Added file type toggles in settings
- PDF disabled by default due to memory issues

## Results

### Before Fixes
- Memory usage: 1,200MB+ after 20 files
- Crash rate: ~100% when indexing large folders
- External memory: Up to 98MB

### After Fixes
- Memory usage: 640MB after 26 files (47% reduction)
- Crash rate: Significantly reduced but not eliminated
- External memory: More stable around 55-65MB

## Remaining Issues

Despite improvements, the memory leak is not completely resolved due to:

1. **Library Limitations**: The transformers.js library has internal memory management issues
2. **ONNX Runtime**: Known memory leaks in ONNX runtime for Node.js
3. **Native Bindings**: Some native resources are not properly released

## Recommended Solutions

### Short-term (Implemented)
1. ✅ Disable PDF indexing by default
2. ✅ Add tensor disposal and memory cleanup
3. ✅ Reduce batch sizes
4. ✅ Add file type filtering

### Medium-term Options
1. **Worker Restart Strategy**: Periodically restart the worker after processing N files
2. **Memory Threshold**: Monitor memory and pause indexing when threshold reached
3. **Sequential Processing**: Process files one at a time with delays

### Long-term Solutions
1. **Alternative Embedding Provider**: 
   - Switch to OpenAI embeddings (cloud-based)
   - Use a different local embedding library
   
2. **Different Model Architecture**:
   - Use quantized models with lower memory footprint
   - Implement model unloading between batches

3. **Native Module Replacement**:
   - Replace transformers.js with a more memory-efficient solution
   - Consider using child processes for isolation

## Technical Details

### Memory Types Explained
- **RSS (Resident Set Size)**: Total memory allocated to the process
- **Heap**: JavaScript objects and closures
- **External**: Memory allocated by C++ objects bound to JavaScript
- **Array Buffers**: Typed arrays for tensor data

### Why External Memory Matters
The spike in external memory (3MB → 98MB) indicates native memory allocation issues. This memory is outside V8's garbage collector control and requires explicit cleanup.

## Conclusion

The memory leak has been significantly mitigated but not completely resolved. The root cause lies in the transformers.js library's memory management, which is beyond our direct control. The implemented fixes reduce memory growth by ~50% and prevent most crashes, making the application usable with the following limitations:

1. PDF indexing disabled by default
2. Large folders may still cause issues
3. Periodic app restarts may be needed for extensive indexing

For a complete solution, switching to a different embedding strategy (cloud-based or alternative local library) is recommended.