import { EventEmitter } from 'node:events';

/**
 * Test implementation of execSync for testing process memory monitoring
 * without actually running shell commands.
 */
export class TestExecSync {
  private mockResults: Map<string, string | Error> = new Map();
  private defaultResult: string | Error = '1024 2048'; // Default RSS VSZ in KB

  /**
   * Mock execSync behavior
   */
  execSync(command: string): string {
    const result = this.mockResults.get(command) || this.defaultResult;

    if (result instanceof Error) {
      throw result;
    }

    return result;
  }

  /**
   * Set mock result for a specific command
   */
  setMockResult(command: string, result: string | Error): void {
    this.mockResults.set(command, result);
  }

  /**
   * Set mock result for ps command pattern
   */
  setMemoryResult(pid: number, rssKB: number, vszKB: number): void {
    const command = `ps -o rss=,vsz= -p ${pid}`;
    this.mockResults.set(command, `${rssKB} ${vszKB}`);
  }

  /**
   * Set mock result for Windows tasklist command
   */
  setWindowsMemoryResult(pid: number, memKB: number): void {
    const command = `tasklist /fi "PID eq ${pid}" /fo csv | findstr "${pid}"`;
    this.mockResults.set(command, `"test.exe","${pid}","Console","1","${memKB} K"`);
  }

  /**
   * Clear all mock results
   */
  clear(): void {
    this.mockResults.clear();
  }

  /**
   * Set default result for unmocked commands
   */
  setDefaultResult(result: string | Error): void {
    this.defaultResult = result;
  }
}

/**
 * Test implementation of child process for testing without spawning real processes
 */
export class TestChildProcess extends EventEmitter {
  public pid: number;
  public killed = false;
  public connected = true;
  public stdout = new EventEmitter() as any;
  public stderr = new EventEmitter() as any;

  private messageHandlers: Array<(message: any) => void> = [];

  constructor(pid = 12345) {
    super();
    this.pid = pid;

    // Simulate process setup
    setTimeout(() => {
      this.emit('spawn');
    }, 10);
  }

  /**
   * Mock send method
   */
  send(message: any): boolean {
    if (!this.connected) {
      throw new Error('Channel closed');
    }

    // Simulate message handling
    setTimeout(() => {
      if (message?.type === 'shutdown') {
        this.connected = false;
        this.emit('exit', 0, null);
      } else {
        // Echo back or handle specific messages
        this.messageHandlers.forEach(handler => {
          try {
            handler(message);
          } catch (error) {
            this.emit('error', error);
          }
        });
      }
    }, 5);

    return true;
  }

  /**
   * Mock kill method
   */
  kill(signal?: any): boolean {
    this.killed = true;
    this.connected = false;

    setTimeout(() => {
      this.emit('exit', 0, signal || null);
    }, 5);

    return true;
  }

  /**
   * Add message handler for testing
   */
  addMessageHandler(handler: (message: any) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Simulate ready message from child
   */
  simulateReady(): void {
    setTimeout(() => {
      this.emit('message', { type: 'ready' });
    }, 50);
  }

  /**
   * Simulate error from child
   */
  simulateError(error: Error): void {
    setTimeout(() => {
      this.emit('error', error);
    }, 10);
  }

  /**
   * Simulate initialization error
   */
  simulateInitError(errorMessage: string): void {
    setTimeout(() => {
      this.emit('message', { type: 'init:err', error: errorMessage });
    }, 30);
  }

  /**
   * Simulate stdout data
   */
  simulateStdout(data: string): void {
    setTimeout(() => {
      this.stdout.emit('data', Buffer.from(data));
    }, 10);
  }

  /**
   * Simulate stderr data
   */
  simulateStderr(data: string): void {
    setTimeout(() => {
      this.stderr.emit('data', Buffer.from(data));
    }, 10);
  }
}

/**
 * Test spawn function that returns TestChildProcess instances
 */
export class TestSpawn {
  private processCounter = 12345;
  private mockProcesses: Map<string, TestChildProcess> = new Map();
  private defaultBehavior: 'success' | 'error' | 'custom' = 'success';

  /**
   * Mock spawn function
   */
  spawn(command: string, args?: string[]): TestChildProcess {
    const pid = this.processCounter++;
    const key = `${command} ${args?.join(' ') || ''}`;

    let process = this.mockProcesses.get(key);
    if (!process) {
      process = new TestChildProcess(pid);

      // Set up default behavior
      if (this.defaultBehavior === 'success') {
        process.simulateReady();
      } else if (this.defaultBehavior === 'error') {
        process.simulateError(new Error('Test spawn error'));
      }
    }

    return process;
  }

  /**
   * Set a specific process for a command
   */
  setMockProcess(command: string, args: string[], process: TestChildProcess): void {
    const key = `${command} ${args.join(' ')}`;
    this.mockProcesses.set(key, process);
  }

  /**
   * Set default behavior for unmocked processes
   */
  setDefaultBehavior(behavior: 'success' | 'error' | 'custom'): void {
    this.defaultBehavior = behavior;
  }

  /**
   * Clear all mock processes
   */
  clear(): void {
    this.mockProcesses.clear();
    this.processCounter = 12345;
  }
}