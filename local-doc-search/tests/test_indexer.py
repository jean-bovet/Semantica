"""
Unit tests for Indexer class.
"""
import os
import tempfile
import numpy as np
from pathlib import Path
from unittest.mock import patch, MagicMock, PropertyMock
import pytest


class TestIndexer:
    """Test suite for Indexer."""
    
    @pytest.fixture
    def temp_index_dir(self):
        """Create temporary directory for index."""
        temp_path = tempfile.mkdtemp()
        yield temp_path
        # Cleanup would go here but we'll let test handle it
        
    @patch('src.indexer.faiss')
    def test_initialization(self, mock_faiss, temp_index_dir):
        """Test indexer initialization."""
        from src.indexer import Indexer
        
        mock_index = MagicMock()
        mock_faiss.IndexFlatL2.return_value = mock_index
        
        indexer = Indexer(index_path=temp_index_dir, dimension=384)
        
        mock_faiss.IndexFlatL2.assert_called_once_with(384)
        assert indexer.index_path == temp_index_dir
        assert indexer.dimension == 384
        assert indexer.index == mock_index
        
    @patch('src.indexer.faiss')
    def test_add_vectors(self, mock_faiss, temp_index_dir):
        """Test adding vectors to index."""
        from src.indexer import Indexer
        
        mock_index = MagicMock()
        mock_index.ntotal = 0
        
        def add_side_effect(vectors):
            mock_index.ntotal += len(vectors)
            
        mock_index.add.side_effect = add_side_effect
        mock_faiss.IndexFlatL2.return_value = mock_index
        
        indexer = Indexer(index_path=temp_index_dir)
        
        # Add vectors
        vectors = np.random.rand(5, 384).astype('float32')
        doc_ids = ["doc1", "doc2", "doc3", "doc4", "doc5"]
        
        indexer.add_vectors(vectors, doc_ids)
        
        mock_index.add.assert_called_once()
        assert mock_index.ntotal == 5
        assert len(indexer.id_to_doc) == 5
        
    @patch('src.indexer.faiss')
    def test_search(self, mock_faiss, temp_index_dir):
        """Test searching in index."""
        from src.indexer import Indexer
        
        mock_index = MagicMock()
        mock_index.ntotal = 10
        
        # Mock search results
        distances = np.array([[0.1, 0.2, 0.3, 0.4, 0.5]])
        indices = np.array([[0, 2, 4, 6, 8]])
        mock_index.search.return_value = (distances, indices)
        
        mock_faiss.IndexFlatL2.return_value = mock_index
        
        indexer = Indexer(index_path=temp_index_dir)
        
        # Setup id mapping
        for i in range(10):
            indexer.id_to_doc[i] = f"doc_{i}"
        
        # Perform search
        query_vector = np.random.rand(1, 384).astype('float32')
        results = indexer.search(query_vector, k=5)
        
        mock_index.search.assert_called_once()
        assert len(results) == 5
        assert results[0] == ("doc_0", 0.1)
        assert results[1] == ("doc_2", 0.2)
        
    @patch('src.indexer.faiss')
    @patch('builtins.open', create=True)
    @patch('src.indexer.pickle')
    def test_save_index(self, mock_pickle, mock_open, mock_faiss, temp_index_dir):
        """Test saving index to disk."""
        from src.indexer import Indexer
        
        mock_index = MagicMock()
        mock_faiss.IndexFlatL2.return_value = mock_index
        mock_faiss.write_index = MagicMock()
        
        indexer = Indexer(index_path=temp_index_dir)
        indexer.id_to_doc = {0: "doc_0", 1: "doc_1"}
        
        indexer.save()
        
        # Check FAISS index was saved
        expected_index_path = os.path.join(temp_index_dir, "index.faiss")
        mock_faiss.write_index.assert_called_once_with(mock_index, expected_index_path)
        
        # Check pickle was used to save mappings
        mock_pickle.dump.assert_called()
        
    @patch('src.indexer.faiss')
    @patch('os.path.exists')
    @patch('builtins.open', create=True)
    @patch('src.indexer.pickle')
    def test_load_index(self, mock_pickle, mock_open, mock_exists, mock_faiss, temp_index_dir):
        """Test loading index from disk."""
        from src.indexer import Indexer
        
        mock_exists.return_value = True
        mock_index = MagicMock()
        mock_faiss.read_index.return_value = mock_index
        mock_pickle.load.return_value = {0: "doc_0", 1: "doc_1"}
        
        indexer = Indexer(index_path=temp_index_dir)
        indexer.load()
        
        expected_index_path = os.path.join(temp_index_dir, "index.faiss")
        mock_faiss.read_index.assert_called_once_with(expected_index_path)
        mock_pickle.load.assert_called()
        
        assert indexer.index == mock_index
        assert indexer.id_to_doc == {0: "doc_0", 1: "doc_1"}
        
    @patch('src.indexer.faiss')
    def test_clear_index(self, mock_faiss, temp_index_dir):
        """Test clearing the index."""
        from src.indexer import Indexer
        
        mock_index = MagicMock()
        mock_index.ntotal = 5
        mock_faiss.IndexFlatL2.return_value = mock_index
        
        indexer = Indexer(index_path=temp_index_dir)
        indexer.id_to_doc = {0: "doc_0", 1: "doc_1"}
        
        indexer.clear()
        
        # Should create new index
        assert mock_faiss.IndexFlatL2.call_count == 2
        assert indexer.id_to_doc == {}
        
    @patch('src.indexer.faiss')
    def test_get_statistics(self, mock_faiss, temp_index_dir):
        """Test getting index statistics."""
        from src.indexer import Indexer
        
        mock_index = MagicMock()
        mock_index.ntotal = 100
        mock_index.d = 384
        mock_faiss.IndexFlatL2.return_value = mock_index
        
        indexer = Indexer(index_path=temp_index_dir)
        indexer.id_to_doc = {i: f"doc_{i}" for i in range(100)}
        
        stats = indexer.get_statistics()
        
        assert stats['total_vectors'] == 100
        assert stats['dimension'] == 384
        assert stats['total_documents'] == 100
        
    @patch('src.indexer.faiss')
    def test_empty_search(self, mock_faiss, temp_index_dir):
        """Test searching in empty index."""
        from src.indexer import Indexer
        
        mock_index = MagicMock()
        mock_index.ntotal = 0
        mock_faiss.IndexFlatL2.return_value = mock_index
        
        indexer = Indexer(index_path=temp_index_dir)
        
        query_vector = np.random.rand(1, 384).astype('float32')
        results = indexer.search(query_vector, k=5)
        
        assert results == []
        
    @patch('src.indexer.faiss')
    def test_batch_add_vectors(self, mock_faiss, temp_index_dir):
        """Test adding vectors in batches."""
        from src.indexer import Indexer
        
        mock_index = MagicMock()
        mock_index.ntotal = 0
        
        def add_side_effect(vectors):
            mock_index.ntotal += len(vectors)
            
        mock_index.add.side_effect = add_side_effect
        mock_faiss.IndexFlatL2.return_value = mock_index
        
        indexer = Indexer(index_path=temp_index_dir)
        
        # Add multiple batches
        for batch in range(3):
            vectors = np.random.rand(10, 384).astype('float32')
            doc_ids = [f"doc_{batch}_{i}" for i in range(10)]
            indexer.add_vectors(vectors, doc_ids)
        
        assert mock_index.ntotal == 30
        assert len(indexer.id_to_doc) == 30
        
    @patch('src.indexer.faiss')
    def test_remove_vectors(self, mock_faiss, temp_index_dir):
        """Test removing vectors from index (if supported)."""
        from src.indexer import Indexer
        
        mock_index = MagicMock()
        mock_faiss.IndexFlatL2.return_value = mock_index
        
        indexer = Indexer(index_path=temp_index_dir)
        
        # This would test remove functionality if implemented
        # Currently FAISS doesn't support removal from IndexFlatL2
        
    @patch('src.indexer.faiss')
    def test_update_vectors(self, mock_faiss, temp_index_dir):
        """Test updating existing vectors."""
        from src.indexer import Indexer
        
        mock_index = MagicMock()
        mock_faiss.IndexFlatL2.return_value = mock_index
        
        indexer = Indexer(index_path=temp_index_dir)
        
        # This would test update functionality
        # Typically implemented as remove + add