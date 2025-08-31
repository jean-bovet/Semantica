/**
 * MetricsCollector - Collects and reports performance metrics
 */

export interface Metrics {
  // Performance metrics
  filesProcessed: number;
  bytesProcessed: number;
  chunksCreated: number;
  embeddingsCreated: number;
  
  // Timing metrics
  avgFileProcessingTime: number;
  avgEmbeddingTime: number;
  avgChunkingTime: number;
  totalProcessingTime: number;
  
  // Memory metrics
  peakMemoryUsage: number;
  currentMemoryUsage: number;
  embedderRestarts: number;
  workerRestarts: number;
  
  // Error metrics
  filesFailedParsing: number;
  filesFailedEmbedding: number;
  totalErrors: number;
  
  // Batch metrics
  avgBatchSize: number;
  totalBatches: number;
  adaptiveBatchAdjustments: number;
}

export class MetricsCollector {
  private metrics: Metrics;
  private timers: Map<string, number> = new Map();
  private samples: Map<string, number[]> = new Map();
  
  constructor() {
    this.reset();
  }
  
  reset(): void {
    this.metrics = {
      filesProcessed: 0,
      bytesProcessed: 0,
      chunksCreated: 0,
      embeddingsCreated: 0,
      avgFileProcessingTime: 0,
      avgEmbeddingTime: 0,
      avgChunkingTime: 0,
      totalProcessingTime: 0,
      peakMemoryUsage: 0,
      currentMemoryUsage: 0,
      embedderRestarts: 0,
      workerRestarts: 0,
      filesFailedParsing: 0,
      filesFailedEmbedding: 0,
      totalErrors: 0,
      avgBatchSize: 0,
      totalBatches: 0,
      adaptiveBatchAdjustments: 0
    };
    this.timers.clear();
    this.samples.clear();
  }
  
  // Increment counters
  incrementFiles(count = 1): void {
    this.metrics.filesProcessed += count;
  }
  
  incrementBytes(bytes: number): void {
    this.metrics.bytesProcessed += bytes;
  }
  
  incrementChunks(count: number): void {
    this.metrics.chunksCreated += count;
  }
  
  incrementEmbeddings(count: number): void {
    this.metrics.embeddingsCreated += count;
  }
  
  incrementErrors(type: 'parsing' | 'embedding' | 'general' = 'general'): void {
    this.metrics.totalErrors++;
    if (type === 'parsing') {
      this.metrics.filesFailedParsing++;
    } else if (type === 'embedding') {
      this.metrics.filesFailedEmbedding++;
    }
  }
  
  incrementRestarts(type: 'embedder' | 'worker'): void {
    if (type === 'embedder') {
      this.metrics.embedderRestarts++;
    } else {
      this.metrics.workerRestarts++;
    }
  }
  
  // Batch tracking
  recordBatch(size: number): void {
    this.metrics.totalBatches++;
    const currentTotal = this.metrics.avgBatchSize * (this.metrics.totalBatches - 1);
    this.metrics.avgBatchSize = (currentTotal + size) / this.metrics.totalBatches;
  }
  
  recordBatchAdjustment(): void {
    this.metrics.adaptiveBatchAdjustments++;
  }
  
  // Timing functions
  startTimer(name: string): void {
    this.timers.set(name, performance.now());
  }
  
  endTimer(name: string): number {
    const start = this.timers.get(name);
    if (!start) return 0;
    
    const duration = performance.now() - start;
    this.timers.delete(name);
    
    // Store sample for averaging
    if (!this.samples.has(name)) {
      this.samples.set(name, []);
    }
    const samples = this.samples.get(name)!;
    samples.push(duration);
    
    // Keep only last 100 samples for moving average
    if (samples.length > 100) {
      samples.shift();
    }
    
    // Update averages
    this.updateAverages(name, samples);
    
    return duration;
  }
  
  private updateAverages(name: string, samples: number[]): void {
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    
    switch (name) {
      case 'file_processing':
        this.metrics.avgFileProcessingTime = avg;
        this.metrics.totalProcessingTime += samples[samples.length - 1];
        break;
      case 'embedding':
        this.metrics.avgEmbeddingTime = avg;
        break;
      case 'chunking':
        this.metrics.avgChunkingTime = avg;
        break;
    }
  }
  
  // Memory tracking
  updateMemory(): void {
    const memUsage = process.memoryUsage();
    this.metrics.currentMemoryUsage = memUsage.rss;
    this.metrics.peakMemoryUsage = Math.max(this.metrics.peakMemoryUsage, memUsage.rss);
  }
  
  // Get current metrics
  getMetrics(): Metrics {
    this.updateMemory();
    return { ...this.metrics };
  }
  
  // Get formatted summary
  getSummary(): string {
    const m = this.getMetrics();
    const mbProcessed = Math.round(m.bytesProcessed / 1024 / 1024);
    const peakMemMB = Math.round(m.peakMemoryUsage / 1024 / 1024);
    const avgFileTime = Math.round(m.avgFileProcessingTime);
    const avgEmbedTime = Math.round(m.avgEmbeddingTime);
    
    return `
📊 Processing Metrics:
  Files: ${m.filesProcessed} processed (${m.filesFailedParsing} parse errors, ${m.filesFailedEmbedding} embed errors)
  Data: ${mbProcessed}MB processed, ${m.chunksCreated} chunks, ${m.embeddingsCreated} embeddings
  Performance: ${avgFileTime}ms/file, ${avgEmbedTime}ms/embedding batch
  Batching: ${m.avgBatchSize.toFixed(1)} avg size, ${m.totalBatches} total, ${m.adaptiveBatchAdjustments} adjustments
  Memory: ${peakMemMB}MB peak, ${m.embedderRestarts} embedder restarts, ${m.workerRestarts} worker restarts
  Total time: ${Math.round(m.totalProcessingTime / 1000)}s
    `.trim();
  }
  
  // Export metrics to JSON
  exportMetrics(): string {
    return JSON.stringify(this.getMetrics(), null, 2);
  }
}