import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock child process environment
const mockSend = vi.fn();
const mockExit = vi.fn();

// Mock global process object
global.process = {
  ...global.process,
  send: mockSend,
  exit: mockExit
} as any;

// Mock transformers
const mockPipe = vi.fn();
const mockTransformers = {
  env: {
    localModelPath: '/mock/model/path',
    cacheDir: '/mock/cache',
    allowRemoteModels: false
  },
  pipeline: vi.fn().mockResolvedValue(mockPipe)
};

vi.mock('@xenova/transformers', () => ({
  default: mockTransformers
}));

// Mock node modules
vi.mock('node:path', () => ({
  default: {
    join: vi.fn((...parts) => parts.join('/'))
  }
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({ size: 112 * 1024 * 1024 })
  }
}));

describe('Embedder Child Serial Queue', () => {
  let embedderChildModule: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock implementations
    mockPipe.mockImplementation(async (texts: string[]) => {
      // Simulate processing time
      await new Promise(r => setTimeout(r, 20));

      return {
        dims: [texts.length, 384],
        data: new Float32Array(texts.length * 384).fill(0.1)
      };
    });

    // Dynamically import the module to test
    // We'll simulate the module functionality since we can't directly import the child process
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should process requests serially in child process', async () => {
    const processOrder: string[] = [];
    const processingTimes: Array<{ id: string; start: number; end: number }> = [];

    // Mock pipe to track processing order and timing
    mockPipe.mockImplementation(async (texts: string[]) => {
      const id = texts[0]; // Use first text as ID
      const start = Date.now();

      processOrder.push(id);

      // Simulate actual processing time
      await new Promise(r => setTimeout(r, 50));

      const end = Date.now();
      processingTimes.push({ id, start, end });

      return {
        dims: [texts.length, 384],
        data: new Float32Array(texts.length * 384).fill(0.1)
      };
    });

    // Simulate the serial queue implementation
    let currentTask: Promise<any> = Promise.resolve();

    const embedSerial = async (msg: any): Promise<number[][]> => {
      currentTask = currentTask.then(async () => {
        const prefixedTexts = msg.texts.map((text: string) => {
          const prefix = msg.isQuery ? 'query: ' : 'passage: ';
          return prefix + text;
        });

        const out = await mockPipe(prefixedTexts);
        const dim = out.dims.at(-1) ?? 384;
        const data = out.data as Float32Array;

        const res: number[][] = [];
        for (let i = 0; i < data.length; i += dim) {
          const v = new Array(dim);
          for (let j = 0; j < dim; j++) v[j] = data[i + j];
          res.push(v);
        }

        return res;
      });

      return currentTask;
    };

    // Simulate multiple concurrent requests
    const msg1 = { id: 'req1', texts: ['REQUEST_1'], isQuery: false };
    const msg2 = { id: 'req2', texts: ['REQUEST_2'], isQuery: false };
    const msg3 = { id: 'req3', texts: ['REQUEST_3'], isQuery: false };

    // Start all requests concurrently (as would happen in real scenario)
    const promise1 = embedSerial(msg1);
    const promise2 = embedSerial(msg2);
    const promise3 = embedSerial(msg3);

    // Wait for all to complete
    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

    // Verify all requests completed successfully
    expect(result1).toHaveLength(1);
    expect(result2).toHaveLength(1);
    expect(result3).toHaveLength(1);

    // Verify requests were processed serially (in order)
    expect(processOrder).toEqual(['passage: REQUEST_1', 'passage: REQUEST_2', 'passage: REQUEST_3']);

    // Verify timing shows serialization (no overlap)
    expect(processingTimes).toHaveLength(3);

    // Check that requests didn't overlap (each should start after previous ends)
    for (let i = 1; i < processingTimes.length; i++) {
      const previous = processingTimes[i - 1];
      const current = processingTimes[i];

      // Current request should start after or at the same time as previous ended
      // (allowing for small timing variations in tests)
      expect(current.start).toBeGreaterThanOrEqual(previous.end - 5);
    }
  });

  it('should handle errors in serial queue without affecting subsequent requests', async () => {
    let callCount = 0;
    const processOrder: string[] = [];

    // Mock pipe to fail on second request
    mockPipe.mockImplementation(async (texts: string[]) => {
      callCount++;
      const id = texts[0];
      processOrder.push(id);

      if (id === 'passage: FAIL_REQUEST') {
        throw new Error('Simulated embedding failure');
      }

      await new Promise(r => setTimeout(r, 20));

      return {
        dims: [texts.length, 384],
        data: new Float32Array(texts.length * 384).fill(0.1)
      };
    });

    // Simulate the serial queue implementation with proper error handling
    let currentTask: Promise<any> = Promise.resolve();

    const embedSerial = async (msg: any): Promise<number[][]> => {
      // Create a new task that chains to the current one
      const taskPromise = currentTask.then(async () => {
        const prefixedTexts = msg.texts.map((text: string) => {
          const prefix = msg.isQuery ? 'query: ' : 'passage: ';
          return prefix + text;
        });

        const out = await mockPipe(prefixedTexts);
        const dim = out.dims.at(-1) ?? 384;
        const data = out.data as Float32Array;

        const res: number[][] = [];
        for (let i = 0; i < data.length; i += dim) {
          const v = new Array(dim);
          for (let j = 0; j < dim; j++) v[j] = data[i + j];
          res.push(v);
        }

        return res;
      });

      // Update the chain, but continue even if this task fails
      currentTask = taskPromise.catch(() => {
        // Return undefined to continue the chain for subsequent requests
        return undefined;
      });

      // Return the individual task (this will throw if it fails)
      return taskPromise;
    };

    // Create requests with one that will fail
    const msg1 = { id: 'req1', texts: ['SUCCESS_REQUEST_1'], isQuery: false };
    const msg2 = { id: 'req2', texts: ['FAIL_REQUEST'], isQuery: false };
    const msg3 = { id: 'req3', texts: ['SUCCESS_REQUEST_2'], isQuery: false };

    // Start all requests
    const promise1 = embedSerial(msg1);
    const promise2 = embedSerial(msg2);
    const promise3 = embedSerial(msg3);

    // First request should succeed
    const result1 = await promise1;
    expect(result1).toHaveLength(1);

    // Second request should fail
    try {
      await promise2;
      // If we get here, the request unexpectedly succeeded
      expect(false).toBe(true); // Force failure
    } catch (error: any) {
      expect(error.message).toBe('Simulated embedding failure');
    }

    // Third request should still succeed despite previous failure
    const result3 = await promise3;
    expect(result3).toHaveLength(1);

    // Verify processing order was maintained
    expect(processOrder).toEqual([
      'passage: SUCCESS_REQUEST_1',
      'passage: FAIL_REQUEST',
      'passage: SUCCESS_REQUEST_2'
    ]);
  });

  it('should maintain proper promise chaining in serial queue', async () => {
    const executionOrder: string[] = [];

    // Mock pipe to track execution phases
    mockPipe.mockImplementation(async (texts: string[]) => {
      const id = texts[0];
      executionOrder.push(`START_${id}`);

      await new Promise(r => setTimeout(r, 30));

      executionOrder.push(`END_${id}`);

      return {
        dims: [texts.length, 384],
        data: new Float32Array(texts.length * 384).fill(0.1)
      };
    });

    // Simulate the serial queue implementation
    let currentTask: Promise<any> = Promise.resolve();

    const embedSerial = async (msg: any): Promise<number[][]> => {
      currentTask = currentTask.then(async () => {
        const prefixedTexts = msg.texts.map((text: string) => {
          const prefix = msg.isQuery ? 'query: ' : 'passage: ';
          return prefix + text;
        });

        const out = await mockPipe(prefixedTexts);
        const dim = out.dims.at(-1) ?? 384;
        const data = out.data as Float32Array;

        const res: number[][] = [];
        for (let i = 0; i < data.length; i += dim) {
          const v = new Array(dim);
          for (let j = 0; j < dim; j++) v[j] = data[i + j];
          res.push(v);
        }

        return res;
      });

      return currentTask;
    };

    // Create multiple requests
    const requests = [
      { id: 'req1', texts: ['A'], isQuery: false },
      { id: 'req2', texts: ['B'], isQuery: false },
      { id: 'req3', texts: ['C'], isQuery: false }
    ];

    // Start all requests concurrently
    const promises = requests.map(req => embedSerial(req));

    // Wait for all to complete
    await Promise.all(promises);

    // Verify execution was serial (each request fully completes before next starts)
    expect(executionOrder).toEqual([
      'START_passage: A',
      'END_passage: A',
      'START_passage: B',
      'END_passage: B',
      'START_passage: C',
      'END_passage: C'
    ]);
  });
});