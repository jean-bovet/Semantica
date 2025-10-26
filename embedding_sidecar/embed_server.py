#!/usr/bin/env python3
"""
Local Embedding Sidecar - FastAPI + Sentence-Transformers

Provides a minimal HTTP API for computing embeddings locally.
Optimized for Mac (Apple Silicon MPS) but works on any platform.

API:
  GET  /health         - Health check
  GET  /info           - Model info (name, dimensions, device)
  POST /embed          - Embed texts
  POST /embed-file     - Embed file with chunking
  GET  /shutdown       - Graceful shutdown
"""

from __future__ import annotations
import os
import sys
import signal
from typing import List, Optional, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
import torch

# -------- Config --------
DEFAULT_MODEL = os.getenv(
    "EMBED_MODEL",
    "sentence-transformers/paraphrase-multilingual-mpnet-base-v2",
)
BIND_HOST = os.getenv("EMBED_HOST", "127.0.0.1")
BIND_PORT = int(os.getenv("EMBED_PORT", "8421"))
CACHE_DIR = os.getenv("HF_HOME")  # optional pre-bundled cache path

# Detect device (prefer Apple MPS, then CUDA, else CPU)
def pick_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"

DEVICE = pick_device()

print(f"🚀 Starting embedding sidecar...")
print(f"   Model: {DEFAULT_MODEL}")
print(f"   Device: {DEVICE}")
print(f"   Bind: {BIND_HOST}:{BIND_PORT}")

# -------- Model load --------
print(f"📦 Loading model (this may take a moment on first run)...")
model = SentenceTransformer(DEFAULT_MODEL, device=DEVICE, cache_folder=CACHE_DIR)
print(f"✅ Model loaded successfully!")
print(f"   Dimensions: {model.get_sentence_embedding_dimension()}")

# -------- App --------
app = FastAPI(title="Local Embedding Sidecar", version="1.0.0")

class EmbedRequest(BaseModel):
    texts: List[str] = Field(min_length=1)
    normalize: bool = True
    pooling: Literal["mean", "cls", "max"] = "mean"
    batch_size: int = Field(default=16, gt=0, le=128)

class EmbedResponse(BaseModel):
    vectors: List[List[float]]

class FileEmbedRequest(BaseModel):
    path: str
    chunk_size: int = Field(default=800, gt=50, le=4000)
    chunk_overlap: int = Field(default=100, ge=0, le=2000)
    max_chunks: int = Field(default=200, gt=0, le=10000)
    normalize: bool = True
    pooling: Literal["mean", "cls", "max"] = "mean"
    batch_size: int = Field(default=16, gt=0, le=128)

class FileEmbedResponse(BaseModel):
    chunks: List[str]
    vectors: List[List[float]]

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/info")
def info():
    dim = model.get_sentence_embedding_dimension()
    return {"model_id": DEFAULT_MODEL, "dim": dim, "device": DEVICE}

@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    try:
        print(f"📥 Embed request: {len(req.texts)} texts, batch_size={req.batch_size}, normalize={req.normalize}")

        vectors = model.encode(
            req.texts,
            batch_size=req.batch_size,
            normalize_embeddings=req.normalize,
            convert_to_numpy=True,
            show_progress_bar=False,
        )

        print(f"✅ Generated {len(vectors)} embeddings")
        return {"vectors": vectors.tolist()}
    except Exception as e:
        print(f"❌ Embedding failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/embed-file", response_model=FileEmbedResponse)
def embed_file(req: FileEmbedRequest):
    path = req.path
    if not os.path.exists(path):
        raise HTTPException(404, f"File not found: {path}")

    text = extract_text(path)
    if not text.strip():
        raise HTTPException(400, "Empty text extracted")

    chunks = chunk_text(text, req.chunk_size, req.chunk_overlap)[: req.max_chunks]
    vectors = model.encode(
        chunks,
        batch_size=req.batch_size,
        normalize_embeddings=req.normalize,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return {"chunks": chunks, "vectors": vectors.tolist()}

def extract_text(path: str) -> str:
    lower = path.lower()
    if lower.endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(path)
        pages = []
        for p in reader.pages:
            try:
                pages.append(p.extract_text() or "")
            except Exception:
                pages.append("")
        return "\n".join(pages)
    elif lower.endswith(".txt"):
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    else:
        # Extend with docx, md, etc. if needed
        raise HTTPException(415, f"Unsupported file type: {path}")

def chunk_text(s: str, size: int, overlap: int) -> List[str]:
    s = " ".join(s.split())  # squish whitespace
    chunks = []
    start = 0
    n = len(s)
    while start < n:
        end = min(start + size, n)
        chunks.append(s[start:end])
        if end == n: break
        start = max(end - overlap, start + 1)
    return chunks

# Graceful shutdown
@app.get("/shutdown")
def shutdown():
    print("🛑 Shutdown requested")
    os.kill(os.getpid(), signal.SIGTERM)
    return {"ok": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "embed_server:app",
        host=BIND_HOST,
        port=BIND_PORT,
        reload=False,
        workers=1,
        log_level="info"
    )
