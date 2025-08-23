# Memory Benchmark Results

## Test Setup
- Model: Xenova/all-MiniLM-L6-v2
- Vector Dimension: 384
- Test Data: Repeated text chunks

## Embedding Memory Test (with onnxruntime-node)

### Configuration
- Backend: node (onnxruntime-node)
- Iterations: 30
- Batch Size: 16 texts
- Text Length: 256 chars
- GC: After every iteration

### Results
- **Initial Memory**: 502MB RSS
- **Final Memory**: 520MB RSS
- **Memory Growth**: 18MB over 30 iterations
- **RSS Slope**: 0.276 MB/iteration
- **External Memory**: Dropped from 56MB to 12MB after first iteration

### Analysis
The native onnxruntime-node backend shows:
1. Moderate memory growth (~0.3MB per iteration)
2. External memory stabilizes after initial spike
3. Heap remains constant at 167MB

## Key Findings

### From Application Testing
When indexing real files in the application:
- **Without indexing**: Stable at ~200MB
- **With indexing (before fixes)**: 1,200MB+ after 20 files
- **With indexing (after fixes)**: 640MB after 26 files

### Memory Leak Sources Identified

1. **Transformer.js Tensors**
   - Output tensors not being disposed
   - Fixed by adding explicit disposal in finally block
   - Reduced leak by ~50%

2. **Batch Processing**
   - Large batches (32) causing memory spikes
   - Reduced to 16 items per batch
   - Added immediate array cleanup

3. **File Content Buffers**
   - File content and chunks retained in memory
   - Added explicit nulling of references
   - Force GC when available

## Recommendations

### Immediate Actions (Implemented)
1. ✅ Tensor disposal after each embedding
2. ✅ Reduced batch sizes
3. ✅ Aggressive reference cleanup
4. ✅ PDF indexing disabled by default

### Further Optimizations Needed

1. **Worker Process Restart**
   - Implement automatic worker restart after N files
   - Monitor RSS and restart when threshold exceeded

2. **Alternative Embedding Strategy**
   - Consider cloud-based embeddings (OpenAI)
   - Evaluate lighter embedding libraries
   - Test WASM backend when stable

3. **Memory Monitoring**
   - Add runtime memory monitoring
   - Pause indexing when memory exceeds threshold
   - Alert user when memory issues detected

## Conclusion

The memory leak is primarily in the transformers.js/onnxruntime integration. While our fixes reduced the leak by ~50%, a complete solution requires either:
1. Periodic worker restarts
2. Alternative embedding provider
3. Wait for upstream library fixes

The application is now usable with these limitations:
- PDF files disabled by default
- Large folders may require app restart
- Memory usage will grow slowly over time (~0.3MB per file batch)