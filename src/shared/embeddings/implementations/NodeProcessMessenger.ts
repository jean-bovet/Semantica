/**
 * Concrete implementation of IProcessMessenger for Node.js child processes.
 * Wraps the Node.js process object for IPC communication.
 */

import { IProcessMessenger } from '../interfaces/IProcessMessenger';

/**
 * Node.js process messenger implementation
 */
export class NodeProcessMessenger implements IProcessMessenger {
  private messageHandlers: Array<(msg: any) => void> = [];
  private disconnectHandlers: Array<() => void> = [];

  constructor(private process: NodeJS.Process) {
    // Set up process event listeners
    this.process.on('message', (msg: any) => {
      this.messageHandlers.forEach(handler => handler(msg));
    });

    this.process.on('disconnect', () => {
      this.disconnectHandlers.forEach(handler => handler());
    });
  }

  /**
   * Send a message to the parent process
   */
  send(message: any): void {
    if (this.process.send) {
      this.process.send(message);
    } else {
      console.warn('[NodeProcessMessenger] process.send is not available');
    }
  }

  /**
   * Register a handler for incoming messages
   */
  onMessage(handler: (msg: any) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Register a handler for disconnect events
   */
  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }

  /**
   * Exit the process
   */
  exit(code: number): void {
    if (process.env.DEBUG_EMBEDDER) {
      console.log(`[NodeProcessMessenger] Exiting with code ${code}`);
    }
    this.process.exit(code);
  }

  /**
   * Check if the process is connected to parent
   */
  isConnected(): boolean {
    // In Node.js, we can check if process.send exists
    return typeof this.process.send === 'function';
  }
}