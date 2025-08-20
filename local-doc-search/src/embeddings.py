import os
import json
import pickle
from typing import List, Dict, Any, Optional
from pathlib import Path
import numpy as np
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

# Optional import for Ollama support
try:
    import ollama
    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False


class EmbeddingGenerator:
    def __init__(self, 
                 model_type: str = "sentence-transformer",
                 model_name: Optional[str] = None,
                 cache_dir: str = "./data/embeddings_cache",
                 json_mode: bool = False):
        
        self.model_type = model_type
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.json_mode = json_mode
        
        if model_type == "sentence-transformer":
            self.model_name = model_name or "all-MiniLM-L6-v2"
            self.model = SentenceTransformer(self.model_name)
            self.embedding_dim = self.model.get_sentence_embedding_dimension()
        elif model_type == "ollama":
            if not OLLAMA_AVAILABLE:
                raise ValueError("Ollama is not installed. Please install with 'pip install ollama' or use sentence-transformer model type instead.")
            self.model_name = model_name or "nomic-embed-text"
            self._check_ollama_model()
            test_embedding = self._get_ollama_embedding("test")
            self.embedding_dim = len(test_embedding)
        else:
            raise ValueError(f"Unsupported model type: {model_type}")
    
    def _check_ollama_model(self):
        try:
            models = ollama.list()
            model_names = [model['name'] for model in models['models']]
            
            if not any(self.model_name in name for name in model_names):
                if self.json_mode:
                    print(json.dumps({"status": "pulling_model", "model": self.model_name}), flush=True)
                else:
                    print(f"Model {self.model_name} not found. Pulling it now...")
                ollama.pull(self.model_name)
                if self.json_mode:
                    print(json.dumps({"status": "model_pulled", "model": self.model_name}), flush=True)
                else:
                    print(f"Model {self.model_name} pulled successfully")
        except Exception as e:
            if self.json_mode:
                print(json.dumps({"status": "ollama_error", "error": str(e)}), flush=True)
            else:
                print(f"Error checking/pulling Ollama model: {e}")
                print("Make sure Ollama is running (ollama serve)")
            raise
    
    def generate_embeddings(self, texts: List[str], 
                           batch_size: int = 32,
                           use_cache: bool = True) -> np.ndarray:
        
        if not texts:
            return np.array([])
        
        embeddings = []
        
        if use_cache:
            cached_embeddings, uncached_indices = self._load_cached_embeddings(texts)
            if len(uncached_indices) == 0:
                return np.array(cached_embeddings)
            
            uncached_texts = [texts[i] for i in uncached_indices]
        else:
            uncached_texts = texts
            uncached_indices = list(range(len(texts)))
            cached_embeddings = [None] * len(texts)
        
        if self.model_type == "sentence-transformer":
            new_embeddings = self._generate_sentence_transformer_embeddings(
                uncached_texts, batch_size
            )
        else:
            new_embeddings = self._generate_ollama_embeddings(uncached_texts)
        
        if use_cache:
            self._save_to_cache(uncached_texts, new_embeddings)
            
            for idx, embedding in zip(uncached_indices, new_embeddings):
                cached_embeddings[idx] = embedding
            
            return np.array(cached_embeddings)
        
        return np.array(new_embeddings)
    
    def _generate_sentence_transformer_embeddings(self, texts: List[str], 
                                                 batch_size: int) -> List[np.ndarray]:
        embeddings = []
        
        # Calculate total number of batches for progress reporting
        total_batches = (len(texts) + batch_size - 1) // batch_size
        
        for batch_idx, i in enumerate(range(0, len(texts), batch_size)):
            batch = texts[i:i + batch_size]
            
            # Report progress in JSON mode
            if self.json_mode:
                current_batch = batch_idx + 1
                # Report which chunk we're processing (approximate)
                current_text_idx = min(i + batch_size // 2, len(texts) - 1)
                print(json.dumps({
                    "status": "generating_embeddings",
                    "current": current_batch,
                    "total": total_batches,
                    "file": f"Batch {current_batch}/{total_batches} (chunks {i+1}-{min(i+batch_size, len(texts))})"
                }), flush=True)
            
            batch_embeddings = self.model.encode(batch)
            embeddings.extend(batch_embeddings)
            
            # Use tqdm only when not in JSON mode
            if not self.json_mode and batch_idx == 0:
                from tqdm import tqdm
                pbar = tqdm(total=total_batches, desc="Generating embeddings")
            elif not self.json_mode:
                pbar.update(1)
        
        if not self.json_mode and total_batches > 0:
            pbar.close()
        
        return embeddings
    
    def _generate_ollama_embeddings(self, texts: List[str]) -> List[np.ndarray]:
        embeddings = []
        
        for text in tqdm(texts, desc="Generating Ollama embeddings", disable=self.json_mode):
            embedding = self._get_ollama_embedding(text)
            embeddings.append(embedding)
        
        return embeddings
    
    def _get_ollama_embedding(self, text: str) -> np.ndarray:
        try:
            response = ollama.embeddings(
                model=self.model_name,
                prompt=text
            )
            return np.array(response['embedding'])
        except Exception as e:
            if self.json_mode:
                print(json.dumps({"status": "embedding_error", "error": str(e)}), flush=True)
            else:
                print(f"Error generating embedding with Ollama: {e}")
            raise
    
    def generate_query_embedding(self, query: str) -> np.ndarray:
        if self.model_type == "sentence-transformer":
            return self.model.encode(query)
        else:
            return self._get_ollama_embedding(query)
    
    def _get_cache_key(self, text: str) -> str:
        import hashlib
        text_hash = hashlib.md5(text.encode()).hexdigest()
        return f"{self.model_type}_{self.model_name}_{text_hash}"
    
    def _load_cached_embeddings(self, texts: List[str]) -> tuple:
        cached_embeddings = []
        uncached_indices = []
        
        for idx, text in enumerate(texts):
            cache_key = self._get_cache_key(text)
            cache_file = self.cache_dir / f"{cache_key}.pkl"
            
            if cache_file.exists():
                try:
                    with open(cache_file, 'rb') as f:
                        embedding = pickle.load(f)
                    cached_embeddings.append(embedding)
                except:
                    cached_embeddings.append(None)
                    uncached_indices.append(idx)
            else:
                cached_embeddings.append(None)
                uncached_indices.append(idx)
        
        return cached_embeddings, uncached_indices
    
    def _save_to_cache(self, texts: List[str], embeddings: List[np.ndarray]):
        for text, embedding in zip(texts, embeddings):
            cache_key = self._get_cache_key(text)
            cache_file = self.cache_dir / f"{cache_key}.pkl"
            
            try:
                with open(cache_file, 'wb') as f:
                    pickle.dump(embedding, f)
            except Exception as e:
                if self.json_mode:
                    print(json.dumps({"status": "cache_error", "error": str(e)}), flush=True)
                else:
                    print(f"Error saving embedding to cache: {e}")
    
    def clear_cache(self):
        import shutil
        if self.cache_dir.exists():
            shutil.rmtree(self.cache_dir)
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            if self.json_mode:
                print(json.dumps({"status": "cache_cleared"}), flush=True)
            else:
                print("Embedding cache cleared")


if __name__ == "__main__":
    print("Testing Sentence Transformer embeddings...")
    generator_st = EmbeddingGenerator(model_type="sentence-transformer")
    
    test_texts = [
        "This is a test document about machine learning.",
        "Python is a great programming language.",
        "The weather is nice today."
    ]
    
    embeddings = generator_st.generate_embeddings(test_texts)
    print(f"Generated {len(embeddings)} embeddings")
    print(f"Embedding dimension: {embeddings.shape[1]}")
    
    query = "Tell me about programming"
    query_embedding = generator_st.generate_query_embedding(query)
    print(f"Query embedding shape: {query_embedding.shape}")
    
    print("\nTesting Ollama embeddings (if available)...")
    try:
        generator_ollama = EmbeddingGenerator(model_type="ollama")
        embeddings_ollama = generator_ollama.generate_embeddings(test_texts[:1])
        print(f"Ollama embedding dimension: {embeddings_ollama.shape[1]}")
    except Exception as e:
        print(f"Ollama test failed (ensure Ollama is running): {e}")