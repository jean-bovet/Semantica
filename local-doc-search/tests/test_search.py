"""
Unit tests for DocumentSearchEngine class.
"""
import os
import tempfile
import json
from pathlib import Path
from unittest.mock import patch, MagicMock, call
import pytest
import numpy as np


class TestDocumentSearchEngine:
    """Test suite for DocumentSearchEngine."""
    
    @pytest.fixture
    def temp_data_dir(self):
        """Create temporary data directory."""
        temp_path = tempfile.mkdtemp()
        index_path = os.path.join(temp_path, 'index')
        os.makedirs(index_path, exist_ok=True)
        yield temp_path
        
    @pytest.fixture
    def mock_dependencies(self):
        """Mock all DocumentSearchEngine dependencies."""
        with patch('src.search.DocumentProcessor') as mock_processor, \
             patch('src.search.EmbeddingGenerator') as mock_embeddings, \
             patch('src.search.FAISSIndexer') as mock_indexer, \
             patch('src.search.MetadataStore') as mock_metadata:
            
            # Setup mock instances
            mock_processor_instance = MagicMock()
            mock_embeddings_instance = MagicMock()
            mock_indexer_instance = MagicMock()
            mock_metadata_instance = MagicMock()
            
            mock_processor.return_value = mock_processor_instance
            mock_embeddings.return_value = mock_embeddings_instance
            mock_indexer.return_value = mock_indexer_instance
            mock_metadata.return_value = mock_metadata_instance
            
            yield {
                'processor': mock_processor_instance,
                'embeddings': mock_embeddings_instance,
                'indexer': mock_indexer_instance,
                'metadata': mock_metadata_instance
            }
            
    def test_initialization(self, temp_data_dir, mock_dependencies):
        """Test search engine initialization."""
        from src.search import DocumentSearchEngine
        
        engine = DocumentSearchEngine(
            index_path=os.path.join(temp_data_dir, 'index'),
            model_name='test-model'
        )
        
        assert engine.index_path == os.path.join(temp_data_dir, 'index')
        assert engine.embeddings is not None
        assert engine.indexer is not None
        assert engine.processor is not None
        
    def test_index_directory(self, temp_data_dir, mock_dependencies):
        """Test indexing a directory."""
        from src.search import DocumentSearchEngine
        from src.document_processor import DocumentChunk
        
        # Setup mocks
        mock_chunks = [
            DocumentChunk(
                content="Test content 1",
                metadata={"file": "test1.txt"},
                chunk_id="chunk1",
                document_id="doc1"
            ),
            DocumentChunk(
                content="Test content 2",
                metadata={"file": "test2.txt"},
                chunk_id="chunk2",
                document_id="doc2"
            )
        ]
        
        mock_dependencies['processor'].process_directory.return_value = mock_chunks
        mock_dependencies['embeddings'].generate_embeddings_batch.return_value = [
            np.random.rand(384).astype('float32'),
            np.random.rand(384).astype('float32')
        ]
        
        engine = DocumentSearchEngine(index_path=os.path.join(temp_data_dir, 'index'))
        result = engine.index_directory("/test/directory")
        
        # Verify calls
        mock_dependencies['processor'].process_directory.assert_called_once_with("/test/directory")
        mock_dependencies['embeddings'].generate_embeddings_batch.assert_called()
        mock_dependencies['indexer'].add_vectors.assert_called()
        
        assert result['documents'] == 2
        assert result['chunks'] == 2
        
    def test_index_directory_incremental(self, temp_data_dir, mock_dependencies):
        """Test incremental indexing."""
        from src.search import DocumentSearchEngine
        from src.document_processor import DocumentChunk
        
        # Setup mocks for incremental indexing
        mock_chunks = [
            DocumentChunk(
                content="New content",
                metadata={"file": "new.txt"},
                chunk_id="chunk_new",
                document_id="doc_new"
            )
        ]
        
        change_info = {
            'new': ['new.txt'],
            'modified': ['modified.txt'],
            'deleted': ['deleted.txt'],
            'unchanged': ['unchanged.txt']
        }
        
        mock_dependencies['processor'].process_directory_incremental.return_value = (
            mock_chunks, change_info
        )
        mock_dependencies['embeddings'].generate_embeddings_batch.return_value = [
            np.random.rand(384).astype('float32')
        ]
        mock_dependencies['metadata'].get_chunks_for_file.return_value = [0, 1]
        
        engine = DocumentSearchEngine(index_path=os.path.join(temp_data_dir, 'index'))
        result = engine.index_directory_incremental("/test/directory")
        
        mock_dependencies['processor'].process_directory_incremental.assert_called_once()
        assert 'new_files' in result
        assert 'modified_files' in result
        
    def test_search(self, temp_data_dir, mock_dependencies):
        """Test searching."""
        from src.search import DocumentSearchEngine
        
        # Setup mocks
        mock_dependencies['embeddings'].generate_embedding.return_value = \
            np.random.rand(384).astype('float32')
        
        mock_dependencies['indexer'].search.return_value = [
            ("chunk1", 0.1),
            ("chunk2", 0.2),
            ("chunk3", 0.3)
        ]
        
        mock_dependencies['indexer'].chunk_metadata = {
            "chunk1": {"file_path": "/test/file1.txt", "content": "Result 1"},
            "chunk2": {"file_path": "/test/file2.txt", "content": "Result 2"},
            "chunk3": {"file_path": "/test/file3.txt", "content": "Result 3"}
        }
        
        engine = DocumentSearchEngine(index_path=os.path.join(temp_data_dir, 'index'))
        results = engine.search("test query", limit=3)
        
        mock_dependencies['embeddings'].generate_embedding.assert_called_once_with("test query")
        mock_dependencies['indexer'].search.assert_called_once()
        
        assert len(results) == 3
        assert all('file_path' in r for r in results)
        assert all('score' in r for r in results)
        
    def test_search_empty_query(self, temp_data_dir, mock_dependencies):
        """Test searching with empty query."""
        from src.search import DocumentSearchEngine
        
        engine = DocumentSearchEngine(index_path=os.path.join(temp_data_dir, 'index'))
        results = engine.search("", limit=5)
        
        assert results == []
        mock_dependencies['embeddings'].generate_embedding.assert_not_called()
        
    def test_search_no_results(self, temp_data_dir, mock_dependencies):
        """Test search with no results."""
        from src.search import DocumentSearchEngine
        
        mock_dependencies['embeddings'].generate_embedding.return_value = \
            np.random.rand(384).astype('float32')
        mock_dependencies['indexer'].search.return_value = []
        
        engine = DocumentSearchEngine(index_path=os.path.join(temp_data_dir, 'index'))
        results = engine.search("no matches", limit=5)
        
        assert results == []
        
    def test_clear_index(self, temp_data_dir, mock_dependencies):
        """Test clearing the index."""
        from src.search import DocumentSearchEngine
        
        engine = DocumentSearchEngine(index_path=os.path.join(temp_data_dir, 'index'))
        engine.clear_index()
        
        mock_dependencies['indexer'].clear.assert_called_once()
        mock_dependencies['metadata'].clear_all.assert_called_once()
        
    def test_get_statistics(self, temp_data_dir, mock_dependencies):
        """Test getting statistics."""
        from src.search import DocumentSearchEngine
        
        mock_dependencies['indexer'].get_statistics.return_value = {
            'total_vectors': 100,
            'dimension': 384
        }
        
        mock_dependencies['metadata'].get_statistics.return_value = {
            'total_files': 10,
            'total_chunks': 100,
            'total_size': 1024000
        }
        
        engine = DocumentSearchEngine(index_path=os.path.join(temp_data_dir, 'index'))
        stats = engine.get_statistics()
        
        assert 'total_documents' in stats
        assert 'total_chunks' in stats
        assert 'index_size' in stats
        
    def test_batch_embedding_generation(self, temp_data_dir, mock_dependencies):
        """Test batch processing of embeddings."""
        from src.search import DocumentSearchEngine
        from src.document_processor import DocumentChunk
        
        # Create many chunks to test batching
        num_chunks = 100
        mock_chunks = [
            DocumentChunk(
                content=f"Content {i}",
                metadata={"file": f"test{i}.txt"},
                chunk_id=f"chunk{i}",
                document_id=f"doc{i}"
            )
            for i in range(num_chunks)
        ]
        
        mock_dependencies['processor'].process_directory.return_value = mock_chunks
        
        # Mock batch embedding generation
        def generate_batch(texts, batch_size=32, show_progress_bar=True):
            return [np.random.rand(384).astype('float32') for _ in texts]
        
        mock_dependencies['embeddings'].generate_embeddings_batch.side_effect = generate_batch
        
        engine = DocumentSearchEngine(index_path=os.path.join(temp_data_dir, 'index'))
        result = engine.index_directory("/test/directory")
        
        # Verify batching occurred
        assert mock_dependencies['embeddings'].generate_embeddings_batch.called
        assert result['chunks'] == num_chunks
        
    def test_error_handling_during_indexing(self, temp_data_dir, mock_dependencies):
        """Test error handling during indexing."""
        from src.search import DocumentSearchEngine
        
        mock_dependencies['processor'].process_directory.side_effect = Exception("Processing error")
        
        engine = DocumentSearchEngine(index_path=os.path.join(temp_data_dir, 'index'))
        
        with pytest.raises(Exception, match="Processing error"):
            engine.index_directory("/test/directory")
            
    def test_search_with_score_threshold(self, temp_data_dir, mock_dependencies):
        """Test searching with score threshold."""
        from src.search import DocumentSearchEngine
        
        mock_dependencies['embeddings'].generate_embedding.return_value = \
            np.random.rand(384).astype('float32')
        
        mock_dependencies['indexer'].search.return_value = [
            ("chunk1", 0.1),
            ("chunk2", 0.5),
            ("chunk3", 0.9)
        ]
        
        mock_dependencies['indexer'].chunk_metadata = {
            "chunk1": {"file_path": "/test/file1.txt", "content": "Result 1"},
            "chunk2": {"file_path": "/test/file2.txt", "content": "Result 2"},
            "chunk3": {"file_path": "/test/file3.txt", "content": "Result 3"}
        }
        
        engine = DocumentSearchEngine(index_path=os.path.join(temp_data_dir, 'index'))
        
        # If score threshold is implemented
        # results = engine.search("test query", limit=10, score_threshold=0.4)
        # assert len(results) == 2  # Only chunks with score < 0.4
        
    def test_deduplication_of_results(self, temp_data_dir, mock_dependencies):
        """Test deduplication of search results from same document."""
        from src.search import DocumentSearchEngine
        
        mock_dependencies['embeddings'].generate_embedding.return_value = \
            np.random.rand(384).astype('float32')
        
        # Multiple chunks from same document
        mock_dependencies['indexer'].search.return_value = [
            ("chunk1", 0.1),
            ("chunk2", 0.2),
            ("chunk3", 0.3)
        ]
        
        mock_dependencies['indexer'].chunk_metadata = {
            "chunk1": {"file_path": "/test/file1.txt", "content": "Part 1"},
            "chunk2": {"file_path": "/test/file1.txt", "content": "Part 2"},  # Same file
            "chunk3": {"file_path": "/test/file2.txt", "content": "Different"}
        }
        
        engine = DocumentSearchEngine(index_path=os.path.join(temp_data_dir, 'index'))
        results = engine.search("test query", limit=10)
        
        # Depending on implementation, might deduplicate by file
        file_paths = [r['file_path'] for r in results]
        # Test would verify deduplication logic