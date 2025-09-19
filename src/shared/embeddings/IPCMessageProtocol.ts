/**
 * Base interface for all IPC messages
 */
export interface BaseIPCMessage {
  type: string;
  id?: string;
  timestamp?: number;
}

/**
 * Message to check if model exists
 */
export interface CheckModelMessage extends BaseIPCMessage {
  type: 'check-model';
}

/**
 * Response to model check
 */
export interface ModelStatusMessage extends BaseIPCMessage {
  type: 'model:status';
  exists: boolean;
  error?: string;
}

/**
 * Message to initialize the embedder
 */
export interface InitMessage extends BaseIPCMessage {
  type: 'init';
  model?: string;
}

/**
 * Message indicating embedder is ready
 */
export interface ReadyMessage extends BaseIPCMessage {
  type: 'ready';
}

/**
 * Message indicating initialization error
 */
export interface InitErrorMessage extends BaseIPCMessage {
  type: 'init:err';
  error: string;
}

/**
 * Message to request embedding
 */
export interface EmbedMessage extends BaseIPCMessage {
  type: 'embed';
  id: string;
  texts: string[];
  isQuery?: boolean;
}

/**
 * Successful embedding response
 */
export interface EmbedSuccessMessage extends BaseIPCMessage {
  type: 'embed:ok';
  id: string;
  vectors: number[][];
}

/**
 * Embedding error response
 */
export interface EmbedErrorMessage extends BaseIPCMessage {
  type: 'embed:err';
  id: string;
  error: string;
}

/**
 * Message to shutdown the child process
 */
export interface ShutdownMessage extends BaseIPCMessage {
  type: 'shutdown';
}

/**
 * Union type of all possible messages
 */
export type IPCMessage =
  | CheckModelMessage
  | ModelStatusMessage
  | InitMessage
  | ReadyMessage
  | InitErrorMessage
  | EmbedMessage
  | EmbedSuccessMessage
  | EmbedErrorMessage
  | ShutdownMessage;

/**
 * Type guards for message validation
 */
export const MessageTypeGuards = {
  isCheckModelMessage: (msg: any): msg is CheckModelMessage =>
    msg?.type === 'check-model',

  isModelStatusMessage: (msg: any): msg is ModelStatusMessage =>
    msg?.type === 'model:status' && typeof msg?.exists === 'boolean',

  isInitMessage: (msg: any): msg is InitMessage =>
    msg?.type === 'init',

  isReadyMessage: (msg: any): msg is ReadyMessage =>
    msg?.type === 'ready',

  isInitErrorMessage: (msg: any): msg is InitErrorMessage =>
    msg?.type === 'init:err' && typeof msg?.error === 'string',

  isEmbedMessage: (msg: any): msg is EmbedMessage =>
    msg?.type === 'embed' &&
    typeof msg?.id === 'string' &&
    Array.isArray(msg?.texts),

  isEmbedSuccessMessage: (msg: any): msg is EmbedSuccessMessage =>
    msg?.type === 'embed:ok' &&
    typeof msg?.id === 'string' &&
    Array.isArray(msg?.vectors),

  isEmbedErrorMessage: (msg: any): msg is EmbedErrorMessage =>
    msg?.type === 'embed:err' &&
    typeof msg?.id === 'string' &&
    typeof msg?.error === 'string',

  isShutdownMessage: (msg: any): msg is ShutdownMessage =>
    msg?.type === 'shutdown'
};

/**
 * Builder class for creating type-safe IPC messages
 */
export class IPCMessageBuilder {
  /**
   * Create a model check message
   */
  static checkModel(): CheckModelMessage {
    return {
      type: 'check-model',
      timestamp: Date.now()
    };
  }

  /**
   * Create a model status response
   */
  static modelStatus(exists: boolean, error?: string): ModelStatusMessage {
    return {
      type: 'model:status',
      exists,
      error,
      timestamp: Date.now()
    };
  }

  /**
   * Create an initialization message
   */
  static init(model?: string): InitMessage {
    return {
      type: 'init',
      model,
      timestamp: Date.now()
    };
  }

  /**
   * Create a ready message
   */
  static ready(): ReadyMessage {
    return {
      type: 'ready',
      timestamp: Date.now()
    };
  }

  /**
   * Create an initialization error message
   */
  static initError(error: string | Error): InitErrorMessage {
    return {
      type: 'init:err',
      error: error instanceof Error ? error.message : error,
      timestamp: Date.now()
    };
  }

  /**
   * Create an embed request message
   */
  static embed(texts: string[], isQuery = false): EmbedMessage {
    return {
      type: 'embed',
      id: this.generateId(),
      texts,
      isQuery,
      timestamp: Date.now()
    };
  }

  /**
   * Create an embed success response
   */
  static embedSuccess(id: string, vectors: number[][]): EmbedSuccessMessage {
    return {
      type: 'embed:ok',
      id,
      vectors,
      timestamp: Date.now()
    };
  }

  /**
   * Create an embed error response
   */
  static embedError(id: string, error: string | Error): EmbedErrorMessage {
    return {
      type: 'embed:err',
      id,
      error: error instanceof Error ? error.message : error,
      timestamp: Date.now()
    };
  }

  /**
   * Create a shutdown message
   */
  static shutdown(): ShutdownMessage {
    return {
      type: 'shutdown',
      timestamp: Date.now()
    };
  }

  /**
   * Generate a unique message ID
   */
  private static generateId(): string {
    return Math.random().toString(36).slice(2);
  }
}

/**
 * Validator for incoming IPC messages
 */
export class IPCMessageValidator {
  /**
   * Validate that a message has the correct basic structure
   */
  static validateMessage(msg: any): msg is IPCMessage {
    if (!msg || typeof msg !== 'object') {
      return false;
    }

    if (typeof msg.type !== 'string') {
      return false;
    }

    // Validate specific message types
    switch (msg.type) {
      case 'check-model':
        return MessageTypeGuards.isCheckModelMessage(msg);
      case 'model:status':
        return MessageTypeGuards.isModelStatusMessage(msg);
      case 'init':
        return MessageTypeGuards.isInitMessage(msg);
      case 'ready':
        return MessageTypeGuards.isReadyMessage(msg);
      case 'init:err':
        return MessageTypeGuards.isInitErrorMessage(msg);
      case 'embed':
        return MessageTypeGuards.isEmbedMessage(msg);
      case 'embed:ok':
        return MessageTypeGuards.isEmbedSuccessMessage(msg);
      case 'embed:err':
        return MessageTypeGuards.isEmbedErrorMessage(msg);
      case 'shutdown':
        return MessageTypeGuards.isShutdownMessage(msg);
      default:
        return false;
    }
  }

  /**
   * Validate and throw if message is invalid
   */
  static requireValidMessage(msg: any): IPCMessage {
    if (!this.validateMessage(msg)) {
      throw new Error(`Invalid IPC message: ${JSON.stringify(msg)}`);
    }
    return msg;
  }

  /**
   * Sanitize a message for safe transmission
   */
  static sanitizeMessage(msg: IPCMessage): IPCMessage {
    // Create a clean copy with only known properties
    const sanitized: any = {
      type: msg.type,
      timestamp: msg.timestamp || Date.now()
    };

    // Add type-specific properties
    switch (msg.type) {
      case 'model:status':
        sanitized.exists = msg.exists;
        if (msg.error) sanitized.error = String(msg.error);
        break;

      case 'init':
        if (msg.model) sanitized.model = String(msg.model);
        break;

      case 'init:err':
        sanitized.error = String(msg.error);
        break;

      case 'embed':
        sanitized.id = String(msg.id);
        sanitized.texts = Array.isArray(msg.texts) ? msg.texts.map(String) : [];
        sanitized.isQuery = Boolean(msg.isQuery);
        break;

      case 'embed:ok':
        sanitized.id = String(msg.id);
        sanitized.vectors = Array.isArray(msg.vectors) ? msg.vectors : [];
        break;

      case 'embed:err':
        sanitized.id = String(msg.id);
        sanitized.error = String(msg.error);
        break;
    }

    return sanitized;
  }
}

/**
 * Helper class for handling IPC message routing
 */
export class IPCMessageRouter {
  private handlers = new Map<string, (msg: IPCMessage) => void | Promise<void>>();

  /**
   * Register a handler for a specific message type
   */
  on<T extends IPCMessage>(
    messageType: T['type'],
    handler: (msg: T) => void | Promise<void>
  ): void {
    this.handlers.set(messageType, handler as any);
  }

  /**
   * Remove a handler for a message type
   */
  off(messageType: string): boolean {
    return this.handlers.delete(messageType);
  }

  /**
   * Route an incoming message to the appropriate handler
   */
  async route(msg: any): Promise<boolean> {
    try {
      const validMessage = IPCMessageValidator.requireValidMessage(msg);
      const handler = this.handlers.get(validMessage.type);

      if (handler) {
        await handler(validMessage);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to route IPC message:', error);
      return false;
    }
  }

  /**
   * Get all registered message types
   */
  getHandledTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.handlers.clear();
  }
}