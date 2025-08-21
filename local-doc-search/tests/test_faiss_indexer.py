"""
Simplified tests for FAISSIndexer - testing essential functionality.
"""
import tempfile
import numpy as np
import pytest
import sys
import os
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from src.indexer import FAISSIndexer
from src.document_processor import DocumentChunk


class TestFAISSIndexer:
    """Essential tests for FAISS indexer."""
    
    @pytest.fixture
    def temp_index_dir(self):
        """Create temporary directory for index."""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield tmpdir
    
    def test_initialization(self, temp_index_dir):
        """Test indexer creates necessary files and structures."""
        indexer = FAISSIndexer(index_dir=temp_index_dir, embedding_dim=384)
        
        assert indexer.embedding_dim == 384
        assert indexer.index is not None
        assert indexer.chunks == []
        assert indexer.index.ntotal == 0
    
    def test_add_and_search_documents(self, temp_index_dir):
        """Test adding documents and searching them."""
        indexer = FAISSIndexer(index_dir=temp_index_dir, embedding_dim=384)
        
        # Create test chunks
        chunks = [
            DocumentChunk(
                content="Python programming language",
                metadata={"file_name": "doc1.txt", "file_path": "/test/doc1.txt"},
                chunk_id="chunk1",
                document_id="doc1"
            ),
            DocumentChunk(
                content="JavaScript web development", 
                metadata={"file_name": "doc2.txt", "file_path": "/test/doc2.txt"},
                chunk_id="chunk2",
                document_id="doc2"
            )
        ]
        
        # Create random embeddings (in real use, these would come from the model)
        embeddings = np.random.rand(2, 384).astype('float32')
        
        # Add documents
        indexer.add_documents(chunks, embeddings)
        
        assert indexer.index.ntotal == 2
        assert len(indexer.chunks) == 2
        assert len(indexer.document_ids) == 2
        
        # Search
        query_embedding = np.random.rand(384).astype('float32')
        results = indexer.search(query_embedding, k=2)
        
        assert len(results) == 2
        assert all(isinstance(r[0], DocumentChunk) for r in results)
        assert all(isinstance(r[1], (float, np.floating)) for r in results)
    
    def test_save_and_load_index(self, temp_index_dir):
        """Test saving and loading index preserves data."""
        # Create and populate index
        indexer1 = FAISSIndexer(index_dir=temp_index_dir, embedding_dim=384)
        
        chunks = [
            DocumentChunk(
                content="Test content",
                metadata={"file_name": "test.txt", "file_path": "/test.txt"},
                chunk_id="chunk1",
                document_id="doc1"
            )
        ]
        embeddings = np.random.rand(1, 384).astype('float32')
        
        indexer1.add_documents(chunks, embeddings)
        indexer1.save_index()
        
        # Load in new indexer
        indexer2 = FAISSIndexer(index_dir=temp_index_dir, embedding_dim=384)
        
        assert indexer2.index.ntotal == 1
        assert len(indexer2.chunks) == 1
        assert indexer2.chunks[0].content == "Test content"
    
    def test_clear_index(self, temp_index_dir):
        """Test clearing the index removes all data."""
        indexer = FAISSIndexer(index_dir=temp_index_dir, embedding_dim=384)
        
        # Add some data
        chunks = [
            DocumentChunk(
                content="Test",
                metadata={"file_name": "test.txt"},
                chunk_id="chunk1",
                document_id="doc1"
            )
        ]
        embeddings = np.random.rand(1, 384).astype('float32')
        indexer.add_documents(chunks, embeddings)
        
        # Clear
        indexer.clear_index()
        
        assert indexer.index.ntotal == 0
        assert len(indexer.chunks) == 0
        assert len(indexer.document_ids) == 0
    
    def test_get_statistics(self, temp_index_dir):
        """Test statistics reporting."""
        indexer = FAISSIndexer(index_dir=temp_index_dir, embedding_dim=384)
        
        stats = indexer.get_statistics()
        
        assert stats["total_documents"] == 0
        assert stats["total_chunks"] == 0
        assert stats["index_size"] == 0
        assert stats["embedding_dimension"] == 384
        assert "created_at" in stats


if __name__ == "__main__":
    pytest.main([__file__, "-v"])