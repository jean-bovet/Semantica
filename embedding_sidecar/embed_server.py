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

# Start timing as early as possible
import time
_script_start = time.time()

def _log_timing(msg: str):
    """Log timing message with elapsed time since script start"""
    elapsed = (time.time() - _script_start) * 1000
    print(f"⏱️  [PYTHON-TIMING] {elapsed:7.0f}ms | {msg}", flush=True)

_log_timing("Script execution started")
import os
_log_timing("Imported: os")
import sys
_log_timing("Imported: sys")
import json
_log_timing("Imported: json")
import signal
_log_timing("Imported: signal")
from typing import List, Optional, Literal
_log_timing("Imported: typing")
from pathlib import Path
_log_timing("Imported: pathlib")

_log_timing("Starting FastAPI import...")
from fastapi import FastAPI, HTTPException
_log_timing("Imported: FastAPI")

_log_timing("Starting Pydantic import...")
from pydantic import BaseModel, Field
_log_timing("Imported: Pydantic")

_log_timing("Starting SentenceTransformer import...")
from sentence_transformers import SentenceTransformer
_log_timing("Imported: SentenceTransformer")

_log_timing("Starting PyTorch import...")
import torch
_log_timing("Imported: PyTorch")

# -------- Progress Reporting --------
def emit_progress(event_type: str, data: dict):
    """Emit JSON progress event to stdout for parent process to parse"""
    event = {"type": event_type, "data": data}
    print(f"PROGRESS:{json.dumps(event)}", flush=True)

# -------- Config --------
_log_timing("Setting up configuration...")
DEFAULT_MODEL = os.getenv(
    "EMBED_MODEL",
    "sentence-transformers/paraphrase-multilingual-mpnet-base-v2",
)
BIND_HOST = os.getenv("EMBED_HOST", "127.0.0.1")
BIND_PORT = int(os.getenv("EMBED_PORT", "8421"))
CACHE_DIR = os.getenv("HF_HOME")  # optional pre-bundled cache path
_log_timing("Configuration complete")

# Detect device (prefer Apple MPS, then CUDA, else CPU)
_log_timing("Detecting device...")
def pick_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"

DEVICE = pick_device()
_log_timing(f"Device detected: {DEVICE}")

print(f"🚀 Starting embedding sidecar...")
print(f"   Model: {DEFAULT_MODEL}")
print(f"   Device: {DEVICE}")
print(f"   Bind: {BIND_HOST}:{BIND_PORT}")

# -------- Model Load with Progress --------
def load_model_with_progress():
    """Load model with download progress reporting"""
    start_time = time.time()

    cache_dir = CACHE_DIR or Path.home() / ".cache" / "huggingface"
    model_repo = DEFAULT_MODEL.replace("/", "--")
    model_path = Path(cache_dir) / f"hub" / f"models--{model_repo}"

    is_cached = model_path.exists()
    if is_cached:
        print(f"⏱️  [TIMING] Loading cached model from {model_path}")
        emit_progress("model_cached", {"model": DEFAULT_MODEL})
    else:
        print(f"⏱️  [TIMING] Downloading model (first run - this may take a few minutes)...")
        emit_progress("download_started", {"model": DEFAULT_MODEL})

    # Load model (sentence-transformers handles download automatically)
    load_start = time.time()
    model = SentenceTransformer(DEFAULT_MODEL, device=DEVICE, cache_folder=str(cache_dir) if CACHE_DIR else None)
    load_duration = (time.time() - load_start) * 1000  # Convert to ms

    total_duration = (time.time() - start_time) * 1000  # Convert to ms
    print(f"⏱️  [TIMING] Model loaded in {load_duration:.0f}ms (total: {total_duration:.0f}ms, cached: {is_cached})")

    emit_progress("model_loaded", {
        "model": DEFAULT_MODEL,
        "dimensions": model.get_sentence_embedding_dimension(),
        "load_time_ms": load_duration,
        "total_time_ms": total_duration,
        "from_cache": is_cached
    })

    return model

# Initialize model as None - will be loaded asynchronously after server starts
model = None
model_loading = False

# -------- App --------
_log_timing("Creating FastAPI app...")
app = FastAPI(title="Local Embedding Sidecar", version="1.0.0")
_log_timing("FastAPI app created")

# Load model after FastAPI server starts (async background task)
@app.on_event("startup")
async def load_model_background():
    """Load model in background after server starts"""
    global model, model_loading

    if model is not None:
        return  # Already loaded

    background_start = time.time()
    model_loading = True
    print(f"⏱️  [TIMING] Background model loading started")

    try:
        model = load_model_with_progress()
        background_duration = (time.time() - background_start) * 1000
        print(f"⏱️  [TIMING] Background model loading completed in {background_duration:.0f}ms")
        print(f"✅ Model loaded successfully!")
        print(f"   Dimensions: {model.get_sentence_embedding_dimension()}")
    except Exception as e:
        print(f"❌ Model loading failed: {str(e)}")
        raise
    finally:
        model_loading = False

_log_timing("Defining Pydantic models...")

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

class OCRDetectRequest(BaseModel):
    path: str

class OCRDetectResponse(BaseModel):
    is_scanned: bool
    page_count: int
    method: str

class OCRExtractRequest(BaseModel):
    path: str
    language: str = "en-US"
    recognition_level: Literal["accurate", "fast"] = "accurate"

class OCRExtractResponse(BaseModel):
    text: str
    pages: List[str]
    confidence: float

_log_timing("Pydantic models defined")
_log_timing("Registering routes...")

@app.get("/health")
def health():
    """Health check endpoint - returns model loading status"""
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "model_loading": model_loading
    }

@app.get("/info")
def info():
    # Check if model is loaded
    if model is None:
        if model_loading:
            raise HTTPException(status_code=503, detail="Model is still loading, please retry shortly")
        else:
            raise HTTPException(status_code=503, detail="Model not loaded")

    dim = model.get_sentence_embedding_dimension()
    return {"model_id": DEFAULT_MODEL, "dim": dim, "device": DEVICE}

@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    # Check if model is loaded
    if model is None:
        if model_loading:
            raise HTTPException(status_code=503, detail="Model is still loading, please retry shortly")
        else:
            raise HTTPException(status_code=503, detail="Model not loaded")

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
    # Check if model is loaded
    if model is None:
        if model_loading:
            raise HTTPException(status_code=503, detail="Model is still loading, please retry shortly")
        else:
            raise HTTPException(status_code=503, detail="Model not loaded")

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

# -------- OCR Endpoints --------

@app.post("/ocr/detect", response_model=OCRDetectResponse)
def detect_scanned_pdf(req: OCRDetectRequest):
    """Detect if PDF needs OCR by checking text density"""
    if not os.path.exists(req.path):
        raise HTTPException(404, f"File not found: {req.path}")

    try:
        # Use pypdf for simple text extraction check
        from pypdf import PdfReader

        print(f"🔍 OCR detection request: {req.path}")
        reader = PdfReader(req.path)

        total_text = ""
        for page in reader.pages:
            total_text += page.extract_text() or ""

        page_count = len(reader.pages)
        avg_chars = len(total_text) / page_count if page_count > 0 else 0
        is_scanned = avg_chars < 50  # Less than 50 chars/page = likely scanned

        print(f"  Pages: {page_count}, avg chars/page: {avg_chars:.1f}, is_scanned: {is_scanned}")

        return {
            "is_scanned": is_scanned,
            "page_count": page_count,
            "method": "text_extraction"
        }
    except Exception as e:
        print(f"❌ OCR detection failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ocr/extract", response_model=OCRExtractResponse)
def extract_with_ocr(req: OCRExtractRequest):
    """Extract text from scanned PDF using macOS Vision framework"""
    if not os.path.exists(req.path):
        raise HTTPException(404, f"File not found: {req.path}")

    try:
        # Lazy imports to avoid slowing down server startup
        from ocrmac import ocrmac
        from pdf2image import convert_from_path
        import tempfile

        print(f"📸 OCR request: {req.path}, language={req.language}, level={req.recognition_level}")

        # Convert PDF to images (one per page)
        # Use lower DPI (200) for faster processing, higher (300) for better quality
        images = convert_from_path(req.path, dpi=200)
        print(f"  Converted {len(images)} pages to images")

        pages_text = []
        total_confidence = 0.0

        with tempfile.TemporaryDirectory() as tmp_dir:
            for i, image in enumerate(images):
                # Save image temporarily
                img_path = Path(tmp_dir) / f"page_{i}.png"
                image.save(img_path, "PNG")

                # Run OCR using Vision framework
                annotations = ocrmac.OCR(
                    str(img_path),
                    language_preference=[req.language],
                    recognition_level=req.recognition_level
                )

                # Extract text and confidence
                page_text = " ".join([item[0] for item in annotations])
                page_confidence = sum([item[1] for item in annotations]) / len(annotations) if annotations else 0

                pages_text.append(page_text)
                total_confidence += page_confidence

                print(f"  Page {i+1}/{len(images)}: {len(page_text)} chars, confidence={page_confidence:.2f}")

        full_text = "\n\n".join(pages_text)
        avg_confidence = total_confidence / len(images) if images else 0

        print(f"✅ OCR complete: {len(full_text)} chars, avg confidence={avg_confidence:.2f}")

        return {
            "text": full_text,
            "pages": pages_text,
            "confidence": avg_confidence
        }

    except Exception as e:
        print(f"❌ OCR failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Graceful shutdown
@app.get("/shutdown")
def shutdown():
    print("🛑 Shutdown requested")
    os.kill(os.getpid(), signal.SIGTERM)
    return {"ok": True}

_log_timing("All routes registered")
_log_timing("Script initialization complete, starting uvicorn...")

if __name__ == "__main__":
    _log_timing("Importing uvicorn...")
    import uvicorn
    _log_timing("Uvicorn imported")

    _log_timing("Starting uvicorn server...")
    uvicorn.run(
        app,  # Pass app object directly to avoid double import
        host=BIND_HOST,
        port=BIND_PORT,
        reload=False,
        workers=1,
        log_level="info"
    )
