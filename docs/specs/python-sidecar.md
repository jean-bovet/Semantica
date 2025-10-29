# Python Sidecar Embedding Service

**Status:** Production (v1.0.3+)
**Port:** 8421 (HTTP)
**Model:** sentence-transformers/paraphrase-multilingual-mpnet-base-v2 (768-dim)

---

## Overview

FastAPI HTTP server providing embedding generation via sentence-transformers. Runs as child process, managed by `PythonSidecarService`.

### Why Python Sidecar?

**Architecture v3** - replacing Ollama after:
- **v1 (TransformersJS):** Out-of-memory crashes, complex child process management
- **v2 (Ollama):** 1-2% EOF error rate, segmentation faults, concurrent request crashes

**Python Sidecar achieves:**
- 100% reliability (vs 98-99% with Ollama)
- Simple lifecycle management
- Clear error messages (Python vs C++ segfaults)
- No manual installation required

## Architecture

```
Electron App (Worker Thread)
    └── PythonSidecarService
        └── spawn python embed_server.py
            └── FastAPI (port 8421)
                └── sentence-transformers model
```

**Communication:** HTTP REST API
**Startup:** Automatic on app launch
**Lifecycle:** Managed by PythonSidecarService

---

## API Endpoints

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "model": "paraphrase-multilingual-mpnet-base-v2",
  "dim": 768,
  "device": "cpu|mps|cuda"
}
```

### POST /embed
Generate embeddings for texts.

**Request:**
```json
{
  "texts": ["text1", "text2"],
  "normalize": true
}
```

**Response:**
```json
{
  "vectors": [[0.1, 0.2, ...], [0.3, 0.4, ...]]
}
```

**Parameters:**
- `texts` (required): Array of strings to embed
- `normalize` (optional): L2 normalize vectors (default: true)

### GET /info
Server and model information.

**Response:**
```json
{
  "model_id": "sentence-transformers/paraphrase-multilingual-mpnet-base-v2",
  "dim": 768,
  "device": "cpu",
  "version": "1.0.0"
}
```

---

## Progress Events

The Python sidecar emits progress events via **stdout** during model loading to communicate startup progress to the TypeScript layer.

### Event Format

Events are JSON objects prefixed with `PROGRESS:` on stdout:

```
PROGRESS:{"type":"<event_type>","data":{...}}
```

### Event Types

#### `model_cached`
Emitted when model is already downloaded and cached locally.

**Example:**
```json
PROGRESS:{"type":"model_cached","data":{"model":"paraphrase-multilingual-mpnet-base-v2"}}
```

**Effect:** Startup stage 6 (`downloading`) is **skipped**

#### `download_started`
Emitted when model needs to be downloaded (first run).

**Example:**
```json
PROGRESS:{"type":"download_started","data":{"model":"paraphrase-multilingual-mpnet-base-v2"}}
```

**Effect:** Triggers startup stage 6 (`downloading`), updates UI with download message

#### `model_loaded`
Emitted when model is fully loaded into memory and ready.

**Example:**
```json
PROGRESS:{"type":"model_loaded","data":{"model":"paraphrase-multilingual-mpnet-base-v2","dimensions":768}}
```

**Effect:** Proceeds to stage 7 (`sidecar_ready`)

### TypeScript Integration

The `PythonSidecarService` parses these events from stdout:

```typescript
// In PythonSidecarService constructor
const service = new PythonSidecarService({
  onProgress: (event: DownloadProgressEvent) => {
    // Forward to WorkerStartup for stage management
    console.log(`Progress: ${event.type}`, event.data);
  }
});
```

**Parsing logic:**
```typescript
this.process.stdout?.on('data', (data) => {
  const lines = data.toString().split('\n');
  for (const line of lines) {
    if (line.startsWith('PROGRESS:')) {
      const jsonStr = line.substring('PROGRESS:'.length);
      const event = JSON.parse(jsonStr);
      if (this.progressCallback) {
        this.progressCallback(event);
      }
    }
  }
});
```

### Implementation in embed_server.py

```python
def emit_progress(event_type: str, data: dict):
    """Emit JSON progress event to stdout for parent process to parse"""
    event = {"type": event_type, "data": data}
    print(f"PROGRESS:{json.dumps(event)}", flush=True)

def load_model_with_progress():
    cache_dir = CACHE_DIR or Path.home() / ".cache" / "huggingface"
    model_path = Path(cache_dir) / f"hub" / f"models--{model_repo}"

    if model_path.exists():
        emit_progress("model_cached", {"model": DEFAULT_MODEL})
    else:
        emit_progress("download_started", {"model": DEFAULT_MODEL})

    model = SentenceTransformer(DEFAULT_MODEL, device=DEVICE)
    emit_progress("model_loaded", {
        "model": DEFAULT_MODEL,
        "dimensions": model.get_sentence_embedding_dimension()
    })
    return model
```

---

## Client Usage

### TypeScript (PythonSidecarClient)

```typescript
import { PythonSidecarClient } from './PythonSidecarClient';

const client = new PythonSidecarClient({ port: 8421 });

// Check health
const healthy = await client.checkHealth();

// Generate embeddings
const vectors = await client.embedBatch(['text1', 'text2'], true);
```

### Configuration

```typescript
interface PythonSidecarClientConfig {
  baseUrl?: string;      // Default: http://127.0.0.1:8421
  port?: number;         // Default: 8421
  timeout?: number;      // Default: 30000 (30s)
  retryAttempts?: number; // Default: 2
  retryDelay?: number;   // Default: 1000 (1s)
}
```

---

## Service Management

### PythonSidecarService

Manages sidecar lifecycle:

```typescript
const service = new PythonSidecarService({
  pythonPath: 'python3',
  scriptPath: './embedding_sidecar/embed_server.py',
  port: 8421,
  autoRestart: true
});

await service.startSidecar();   // Start process
await service.stopSidecar();    // Stop process
await service.restartSidecar(); // Restart
const status = await service.getStatus(); // Check status
```

**Auto-restart:** Enabled by default. Restarts on crash (2s delay).

---

## Performance

**Throughput:** 55-93 texts/sec
**Memory:** 400-600MB stable
**Latency:** 11-18ms per text (batched)
**Reliability:** 100% (vs 98-99% with Ollama)

**Optimal Settings:**
- Batch size: 32 texts
- Concurrent requests: Serial (Python GIL limitation)
- Timeout: 30s

---

## Development

### Prerequisites

**Python Requirements:**
- Python 3.9 or later
- pip (Python package installer)
- 2.2 GB free disk space for dependencies

**Automatic Detection:**

The app automatically detects and uses a virtual environment if present at `embedding_sidecar/.venv/`:

```bash
cd embedding_sidecar
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**Fallback Behavior:**
- **Development:** If no venv found, falls back to system `python3` with warning
- **Production:** Uses system `python3` (bundling deferred to Phase 3)

**Pre-flight Checks:**

On startup, the app verifies:
1. Python interpreter is available
2. All required dependencies are installed:
   - fastapi, uvicorn, pydantic
   - sentence-transformers, torch
   - pypdf

If any check fails, the app shows a context-aware error message with installation instructions.

See [Python Setup Guide](../guides/python-setup.md) for detailed installation instructions and troubleshooting.

### Running Standalone

```bash
cd embedding_sidecar
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python embed_server.py --port 8421
```

### Testing

```bash
# Health check
curl http://localhost:8421/health

# Embed text
curl -X POST http://localhost:8421/embed \
  -H "Content-Type: application/json" \
  -d '{"texts":["test"],"normalize":true}'
```

### Debugging

Use LOG_CATEGORIES environment variable:

```bash
LOG_CATEGORIES=SIDECAR-CLIENT,SIDECAR-SERVICE npm run dev
```

---

## Error Handling

**Network errors:** Auto-retry (2 attempts)
**4xx errors:** No retry (client error)
**5xx errors:** Auto-retry (server error)
**Timeout:** 30s default

**Error types:**
- `PYTHON_NOT_FOUND`: Python interpreter not found in PATH
- `PYTHON_DEPS_MISSING`: Required Python dependencies not installed
- `PYTHON_VERSION_INCOMPATIBLE`: Python version < 3.9
- `SIDECAR_START_FAILED`: Failed to spawn Python process
- `NETWORK_ERROR`: Connection refused, network issues
- `TIMEOUT`: Request exceeded timeout
- `HTTP_ERROR`: HTTP 4xx/5xx responses
- `PARSE_ERROR`: Invalid JSON response

---

## Migration Notes

**From Ollama:**
- Removed promise queue (no longer needed)
- Reduced timeout: 300s → 30s
- Simpler retry logic: 3 → 2 attempts
- DB version 4: One-time re-index required

**Removed workarounds:**
- Request serialization (~35 lines)
- Failed batch logging (~50 lines)
- Complex health checks (~100 lines)
- EOF error handling (~20 lines)

**Total code removed:** ~205 lines
