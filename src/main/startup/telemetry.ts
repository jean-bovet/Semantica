export class StartupTelemetry {
  private marks = new Map<string, number>();
  
  mark(event: string): void {
    this.marks.set(event, Date.now());
  }
  
  measure(from: string, to: string): number {
    const start = this.marks.get(from);
    const end = this.marks.get(to);
    return end && start ? end - start : -1;
  }
  
  report(): void {
    if (process.env.NODE_ENV === 'development') {
      console.log('Startup Metrics:');
      console.log(`  Time to window: ${this.measure('app-start', 'window-shown')}ms`);
      console.log(`  Time to worker: ${this.measure('app-start', 'worker-ready')}ms`);
      console.log(`  Time to model: ${this.measure('app-start', 'model-ready')}ms`);
      console.log(`  Time to files: ${this.measure('app-start', 'files-loaded')}ms`);
      console.log(`  Time to ready: ${this.measure('app-start', 'app-ready')}ms`);
    }
  }
}
