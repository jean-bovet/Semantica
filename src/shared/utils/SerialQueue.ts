/**
 * A serial queue that processes async operations one at a time using promise chaining.
 * Ensures operations are executed in the order they were added, with proper error isolation.
 */
export class SerialQueue<T = any> {
  private currentTask: Promise<any> = Promise.resolve();
  private isShutdown = false;

  /**
   * Add an async operation to the queue.
   * The operation will be executed after all previously queued operations complete.
   *
   * @param operation - Async function to execute
   * @returns Promise that resolves with the operation result
   */
  async add<R>(operation: () => Promise<R>): Promise<R> {
    if (this.isShutdown) {
      throw new Error('Queue is shutdown');
    }

    // Chain the new operation to the current task
    this.currentTask = this.currentTask.then(
      // Success path: execute the operation
      async () => {
        if (this.isShutdown) {
          throw new Error('Queue was shutdown while operation was queued');
        }
        return operation();
      },
      // Error path: still execute the operation (error isolation)
      async () => {
        if (this.isShutdown) {
          throw new Error('Queue was shutdown while operation was queued');
        }
        return operation();
      }
    );

    return this.currentTask;
  }

  /**
   * Get the current queue status
   */
  getStatus(): { isIdle: boolean; isShutdown: boolean } {
    return {
      isIdle: this.currentTask === Promise.resolve(),
      isShutdown: this.isShutdown
    };
  }

  /**
   * Wait for all currently queued operations to complete
   */
  async drain(): Promise<void> {
    try {
      await this.currentTask;
    } catch {
      // Ignore errors during drain - we just want to wait for completion
    }
  }

  /**
   * Shutdown the queue and reject any future operations
   */
  shutdown(): void {
    this.isShutdown = true;
  }

  /**
   * Reset the queue to initial state (for testing purposes)
   */
  reset(): void {
    this.currentTask = Promise.resolve();
    this.isShutdown = false;
  }
}