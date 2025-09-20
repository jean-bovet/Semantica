/**
 * Interface for process communication.
 * Abstracts IPC mechanisms (Node.js process, WebWorker, etc.)
 */

/**
 * Abstraction for inter-process communication
 */
export interface IProcessMessenger {
  /**
   * Send a message to the parent/other process
   * @param message - Message to send
   */
  send(message: any): void;

  /**
   * Register a handler for incoming messages
   * @param handler - Function to handle incoming messages
   */
  onMessage(handler: (msg: any) => void): void;

  /**
   * Register a handler for disconnect events
   * @param handler - Function to handle disconnect
   */
  onDisconnect(handler: () => void): void;

  /**
   * Exit the current process
   * @param code - Exit code (0 for success, non-zero for error)
   */
  exit(code: number): void;

  /**
   * Check if messenger is connected
   * @returns true if connected, false otherwise
   */
  isConnected?(): boolean;
}