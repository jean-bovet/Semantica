/**
 * Embedder child process - Refactored with dependency injection and testable components.
 * This is now a thin orchestration layer that wires together testable components.
 */

import { EmbedderCore } from '../../shared/embeddings/EmbedderCore';
import { EmbedderIPCAdapter } from '../../shared/embeddings/EmbedderIPCAdapter';
import { TransformersModelLoader } from '../../shared/embeddings/implementations/TransformersModelLoader';
import { NodeProcessMessenger } from '../../shared/embeddings/implementations/NodeProcessMessenger';
import { EmbeddingProcessor } from '../../shared/embeddings/EmbeddingProcessor';
import { SerialQueue } from '../../shared/utils/SerialQueue';
import { ModelPathResolver } from '../../shared/embeddings/ModelPathResolver';

// Wire up dependencies
const pathResolver = new ModelPathResolver();
const modelLoader = new TransformersModelLoader(pathResolver);
const processor = new EmbeddingProcessor();
const queue = new SerialQueue();

// Create core business logic (fully testable without IPC or process concerns)
const core = new EmbedderCore(modelLoader, processor, queue, {
  defaultDimension: 384,
  modelName: 'Xenova/multilingual-e5-small'
});

// Create IPC adapter (handles all message routing, also testable)
const messenger = new NodeProcessMessenger(process);
const adapter = new EmbedderIPCAdapter(core, messenger);

// Start the embedder
if (process.env.DEBUG_EMBEDDER) {
  console.log('[EMBEDDER] Starting embedder child process');
}
adapter.start();