# Python Sidecar Embedding Service

**Status:** Production (v1.0.3+)
**Port:** 8421 (HTTP)
**Model:** sentence-transformers/paraphrase-multilingual-mpnet-base-v2 (768-dim)

---

## Overview

FastAPI HTTP server providing embedding generation via sentence-transformers. Runs as child process, managed by `PythonSidecarService`.

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
