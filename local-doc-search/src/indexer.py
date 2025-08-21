import os
import json
import pickle
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import numpy as np
import faiss
from datetime import datetime
from document_processor import DocumentChunk
from paths import get_index_dir


class FAISSIndexer:
    def __init__(self, index_dir: Optional[str] = None, embedding_dim: int = 384, json_mode: bool = False):
        # Use Application Support by default
        if index_dir is None:
            index_dir = str(get_index_dir())
        self.index_dir = Path(index_dir)
        self.index_dir.mkdir(parents=True, exist_ok=True)
        self.embedding_dim = embedding_dim
        self.json_mode = json_mode
        
        self.index_path = self.index_dir / "faiss.index"
        self.metadata_path = self.index_dir / "metadata.json"
        self.chunks_path = self.index_dir / "chunks.pkl"
        self.config_path = self.index_dir / "index_config.json"
        
        self.index = None
        self.metadata = {}
        self.chunks = []
        self.document_ids = set()
        
        self._load_or_create_index()
    
    def _load_or_create_index(self):
        if self.index_path.exists():
            self.load_index()
        else:
            self.create_new_index()
    
    def create_new_index(self, index_type: str = "Flat"):
        if index_type == "Flat":
            self.index = faiss.IndexFlatL2(self.embedding_dim)
        elif index_type == "IVFFlat":
            quantizer = faiss.IndexFlatL2(self.embedding_dim)
            self.index = faiss.IndexIVFFlat(quantizer, self.embedding_dim, 100)
        else:
            raise ValueError(f"Unsupported index type: {index_type}")
        
        self.metadata = {
            "created_at": datetime.now().isoformat(),
            "index_type": index_type,
            "embedding_dim": self.embedding_dim,
            "total_documents": 0,
            "total_chunks": 0
        }
        
        self.chunks = []
        self.document_ids = set()
        
        if self.json_mode:
            print(json.dumps({"status": "index_created", "type": index_type, "dimension": self.embedding_dim}), flush=True)
        else:
            print(f"Created new {index_type} index with dimension {self.embedding_dim}")
    
    def add_documents(self, chunks: List[DocumentChunk], embeddings: np.ndarray):
        if len(chunks) != len(embeddings):
            raise ValueError("Number of chunks must match number of embeddings")
        
        if len(chunks) == 0:
            if self.json_mode:
                print(json.dumps({"status": "no_chunks"}), flush=True)
            else:
                print("No chunks to add")
            return
        
        if embeddings.shape[1] != self.embedding_dim:
            raise ValueError(f"Embedding dimension mismatch. Expected {self.embedding_dim}, got {embeddings.shape[1]}")
        
        start_idx = len(self.chunks)
        
        embeddings = embeddings.astype('float32')
        
        if isinstance(self.index, faiss.IndexIVFFlat) and not self.index.is_trained:
            if self.json_mode:
                print(json.dumps({"status": "training_index"}), flush=True)
            else:
                print("Training IVF index...")
            self.index.train(embeddings)
        
        self.index.add(embeddings)
        
        for chunk in chunks:
            self.chunks.append(chunk)
            self.document_ids.add(chunk.document_id)
        
        self.metadata["total_documents"] = len(self.document_ids)
        self.metadata["total_chunks"] = len(self.chunks)
        self.metadata["last_updated"] = datetime.now().isoformat()
        
        if self.json_mode:
            print(json.dumps({"status": "chunks_added", "added": len(chunks), "total": len(self.chunks)}), flush=True)
        else:
            print(f"Added {len(chunks)} chunks to index. Total chunks: {len(self.chunks)}")
    
    def get_index_size(self) -> int:
        """Get the current size of the index (number of vectors)"""
        if self.index:
            return self.index.ntotal
        return 0
    
    def search(self, query_embedding: np.ndarray, k: int = 10) -> List[Tuple[DocumentChunk, float]]:
        if self.index is None or self.index.ntotal == 0:
            if self.json_mode:
                print(json.dumps({"status": "index_empty"}), flush=True)
            else:
                print("Index is empty")
            return []
        
        query_embedding = np.array([query_embedding]).astype('float32')
        
        if query_embedding.shape[1] != self.embedding_dim:
            raise ValueError(f"Query embedding dimension mismatch. Expected {self.embedding_dim}, got {query_embedding.shape[1]}")
        
        k = min(k, self.index.ntotal)
        
        distances, indices = self.index.search(query_embedding, k)
        
        results = []
        for idx, distance in zip(indices[0], distances[0]):
            if idx >= 0 and idx < len(self.chunks):
                chunk = self.chunks[idx]
                similarity_score = 1 / (1 + distance)
                results.append((chunk, similarity_score))
        
        return results
    
    def save_index(self):
        if self.json_mode:
            print(json.dumps({"status": "saving_index"}), flush=True)
        else:
            print("Saving index...")
        
        faiss.write_index(self.index, str(self.index_path))
        
        with open(self.metadata_path, 'w') as f:
            json.dump(self.metadata, f, indent=2)
        
        with open(self.chunks_path, 'wb') as f:
            pickle.dump(self.chunks, f)
        
        config = {
            "embedding_dim": self.embedding_dim,
            "index_type": self.metadata.get("index_type", "Flat")
        }
        with open(self.config_path, 'w') as f:
            json.dump(config, f, indent=2)
        
        if self.json_mode:
            print(json.dumps({"status": "index_saved", "path": str(self.index_dir)}), flush=True)
        else:
            print(f"Index saved to {self.index_dir}")
    
    def load_index(self):
        if not self.index_path.exists():
            raise ValueError(f"No index found at {self.index_path}")
        
        if self.json_mode:
            print(json.dumps({"status": "loading_index"}), flush=True)
        else:
            print("Loading existing index...")
        
        self.index = faiss.read_index(str(self.index_path))
        
        with open(self.metadata_path, 'r') as f:
            self.metadata = json.load(f)
        
        with open(self.chunks_path, 'rb') as f:
            self.chunks = pickle.load(f)
        
        if self.config_path.exists():
            with open(self.config_path, 'r') as f:
                config = json.load(f)
                self.embedding_dim = config.get("embedding_dim", self.embedding_dim)
        
        self.document_ids = {chunk.document_id for chunk in self.chunks}
        
        if self.json_mode:
            print(json.dumps({"status": "index_loaded", "chunks": len(self.chunks), "documents": len(self.document_ids)}), flush=True)
        else:
            print(f"Loaded index with {len(self.chunks)} chunks from {len(self.document_ids)} documents")
    
    def clear_index(self):
        self.create_new_index(self.metadata.get("index_type", "Flat"))
        
        for file in [self.index_path, self.metadata_path, self.chunks_path, self.config_path]:
            if file.exists():
                file.unlink()
        
        if self.json_mode:
            print(json.dumps({"status": "index_cleared"}), flush=True)
        else:
            print("Index cleared")
    
    def remove_document(self, document_id: str):
        if document_id not in self.document_ids:
            if self.json_mode:
                print(json.dumps({"status": "document_not_found", "document_id": document_id}), flush=True)
            else:
                print(f"Document {document_id} not found in index")
            return
        
        indices_to_keep = [i for i, chunk in enumerate(self.chunks) 
                          if chunk.document_id != document_id]
        
        if len(indices_to_keep) == len(self.chunks):
            if self.json_mode:
                print(json.dumps({"status": "no_chunks_found", "document_id": document_id}), flush=True)
            else:
                print(f"No chunks found for document {document_id}")
            return
        
        new_chunks = [self.chunks[i] for i in indices_to_keep]
        
        if len(indices_to_keep) > 0:
            old_embeddings = []
            for i in range(self.index.ntotal):
                embedding = self.index.reconstruct(i)
                old_embeddings.append(embedding)
            
            old_embeddings = np.array(old_embeddings)
            new_embeddings = old_embeddings[indices_to_keep]
            
            self.create_new_index(self.metadata.get("index_type", "Flat"))
            
            if len(new_embeddings) > 0:
                self.index.add(new_embeddings.astype('float32'))
        else:
            self.create_new_index(self.metadata.get("index_type", "Flat"))
        
        self.chunks = new_chunks
        self.document_ids.discard(document_id)
        
        self.metadata["total_documents"] = len(self.document_ids)
        self.metadata["total_chunks"] = len(self.chunks)
        self.metadata["last_updated"] = datetime.now().isoformat()
        
        if self.json_mode:
            print(json.dumps({"status": "document_removed", "document_id": document_id, "remaining_chunks": len(self.chunks)}), flush=True)
        else:
            print(f"Removed document {document_id}. Remaining chunks: {len(self.chunks)}")
    
    def get_statistics(self) -> Dict[str, Any]:
        return {
            "total_documents": len(self.document_ids),
            "total_chunks": len(self.chunks),
            "index_size": self.index.ntotal if self.index else 0,
            "embedding_dimension": self.embedding_dim,
            "index_type": self.metadata.get("index_type", "Unknown"),
            "created_at": self.metadata.get("created_at", "Unknown"),
            "last_updated": self.metadata.get("last_updated", "Unknown")
        }


if __name__ == "__main__":
    indexer = FAISSIndexer(embedding_dim=384)
    
    stats = indexer.get_statistics()
    print("Index statistics:")
    for key, value in stats.items():
        print(f"  {key}: {value}")
    
    from document_processor import DocumentProcessor
    processor = DocumentProcessor()
    
    test_chunks = [
        DocumentChunk(
            content="This is a test document about Python programming.",
            metadata={"file_name": "test1.txt"},
            chunk_id="chunk1",
            document_id="doc1"
        ),
        DocumentChunk(
            content="Machine learning is a subset of artificial intelligence.",
            metadata={"file_name": "test2.txt"},
            chunk_id="chunk2",
            document_id="doc2"
        )
    ]
    
    test_embeddings = np.random.rand(2, 384).astype('float32')
    
    indexer.add_documents(test_chunks, test_embeddings)
    
    query_embedding = np.random.rand(384).astype('float32')
    results = indexer.search(query_embedding, k=2)
    
    print(f"\nSearch results: Found {len(results)} matches")
    for chunk, score in results:
        print(f"  Score: {score:.4f} - {chunk.content[:50]}...")
    
    indexer.save_index()