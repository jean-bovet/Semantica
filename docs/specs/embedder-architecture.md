# Embedder Architecture

**Current Version:** v3 (Python Sidecar)
**Status:** Production
**Last Updated:** 2025-10-27

---

## Current Architecture

Semantica uses a **Python-based FastAPI embedding sidecar** for generating vector embeddings. This is the third iteration of the embedder system, designed for maximum reliability and simplicity.

**For complete technical details, see:** [python-sidecar.md](./python-sidecar.md)

---

## Quick Overview

### System Components

```
Worker Thread
    └── PythonSidecarService
        └── spawn python embed_server.py
            └── FastAPI (port 8421)
                └── sentence-transformers model
```

**Model:** `paraphrase-multilingual-mpnet-base-v2` (768-dim)
**Communication:** HTTP REST API
**Port:** 8421 (local only)
**Startup:** Automatic on app launch
**Memory:** 400-600MB stable usage

### Key Features

✅ **100% Reliability** - No EOF errors, no segmentation faults
✅ **Simple Management** - Single Python process, HTTP API
✅ **Auto-lifecycle** - Managed by PythonSidecarService
✅ **Clear Errors** - Python stack traces vs C++ crashes
✅ **No Dependencies** - Self-contained, no manual setup

---

## Architecture Evolution

### v1: TransformersJS + ONNX Runtime (2024-08 to 2024-10)

**Technology:**
- HuggingFace Transformers.js
- ONNX Runtime for inference
- Child process architecture
- IPC message protocol

**Problems:**
- Memory leaks requiring frequent restarts
- Complex child process management
- SIGTRAP crashes in worker threads
- High memory footprint (>1.5GB)

**Removed:**
- ~20 TypeScript files
- EmbedderCore, EmbedderIPCAdapter, EmbedderPool
- Complex IPC protocol and retry logic

### v2: Ollama (2024-10 to 2024-10-26)

**Technology:**
- Ollama local server
- bge-m3 → nomic-embed-text models
- HTTP API communication
- Automatic model management

**Problems:**
- 1-2% EOF error rate
- Upstream llama.cpp segmentation faults
- Concurrent request crashes
- Required workarounds (promise queue, retry logic)

**Removed:**
- OllamaService, OllamaClient, OllamaEmbedder
- Request serialization code (~35 lines)
- Complex retry and error handling (~120 lines)

### v3: Python Sidecar (2024-10-27 to present)

**Technology:**
- FastAPI HTTP server
- sentence-transformers library
- Direct Apple MPS (Metal) acceleration
- Simple REST API

**Benefits:**
- 100% success rate (vs 98-99% with Ollama)
- Simpler codebase (~205 lines of workarounds removed)
- Better error messages (Python vs C++)
- Comparable performance (55-93 texts/sec)
- No external dependencies

---

## API Reference

### Endpoints

**GET /health** - Health check
**POST /embed** - Generate embeddings
**GET /info** - Server information

### Client Usage

```typescript
import { PythonSidecarEmbedder } from './implementations/PythonSidecarEmbedder';

const embedder = new PythonSidecarEmbedder({
  modelName: 'paraphrase-multilingual-mpnet-base-v2',
  batchSize: 32,
  normalizeVectors: true
});

await embedder.initialize();
const vectors = await embedder.embed(['text1', 'text2']);
```

---

## Documentation

- **[python-sidecar.md](./python-sidecar.md)** - Complete technical specification
- **[02-architecture.md](./02-architecture.md)** - Overall system architecture
- **[python-sidecar-performance-guide.md](../guides/python-sidecar-performance-guide.md)** - Performance tuning
- **[ollama-to-sidecar-migration.md](../guides/ollama-to-sidecar-migration.md)** - Migration guide

---

## Archive

For historical reference, documentation for previous architectures is available in:
- `docs/specs/archive/embedder/` - v1 (TransformersJS) architecture
- `planning/archive/` - Ollama migration and troubleshooting docs

---

*This document reflects the current production embedder architecture as of October 2025.*
