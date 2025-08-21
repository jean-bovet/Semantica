"""
Integration tests for DocumentSearchEngine class.
"""
import os
import tempfile
import json
from pathlib import Path
import pytest
import sys
import numpy as np

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from search import DocumentSearchEngine
from document_processor import DocumentChunk


class TestDocumentSearchEngine:
    """Test suite for DocumentSearchEngine."""
    
    @pytest.fixture
    def temp_data_dir(self):
        """Create temporary data directory."""
        temp_path = tempfile.mkdtemp()
        index_path = os.path.join(temp_path, 'index')
        os.makedirs(index_path, exist_ok=True)
        yield temp_path
        
    def test_initialization(self, temp_data_dir):
        """Test engine initialization."""
        engine = DocumentSearchEngine(
            index_dir=os.path.join(temp_data_dir, 'index'),
            json_mode=True
        )
        
        assert engine.indexer is not None
        assert engine.embedding_generator is not None
        assert engine.document_processor is not None
        assert engine.json_mode is True
    
    def test_clear_index(self, temp_data_dir):
        """Test clearing the index."""
        engine = DocumentSearchEngine(
            index_dir=os.path.join(temp_data_dir, 'index'),
            json_mode=True
        )
        
        # Clear index (should work even with empty index)
        engine.clear_index()
        
        stats = engine.indexer.get_statistics()
        assert stats['total_chunks'] == 0
        assert stats['total_documents'] == 0
    
    def test_search_empty_query(self, temp_data_dir):
        """Test searching with empty query."""
        engine = DocumentSearchEngine(
            index_dir=os.path.join(temp_data_dir, 'index'),
            json_mode=True
        )
        
        # Search with empty query
        results = engine.search("", display_results=False)
        assert results == []
    
    def test_add_document_and_search(self, temp_data_dir):
        """Test adding a document and searching for it."""
        # Create a test file
        test_file = os.path.join(temp_data_dir, 'test.txt')
        with open(test_file, 'w') as f:
            f.write("This is a test document about machine learning and artificial intelligence.")
        
        engine = DocumentSearchEngine(
            index_dir=os.path.join(temp_data_dir, 'index'),
            json_mode=True
        )
        
        # Add the document
        engine.add_document(test_file)
        
        # Search for content
        results = engine.search("machine learning", k=5, display_results=False)
        
        # Should find results
        assert len(results) > 0
        assert isinstance(results[0][0], DocumentChunk)
        assert isinstance(results[0][1], (float, int, np.floating))
    
    def test_index_directory(self, temp_data_dir):
        """Test indexing a directory of documents."""
        # Create test files
        docs_dir = os.path.join(temp_data_dir, 'docs')
        os.makedirs(docs_dir)
        
        for i in range(3):
            with open(os.path.join(docs_dir, f'doc{i}.txt'), 'w') as f:
                # Write enough content to create chunks
                content = f"Document {i} content. " * 20
                content += f"This is document number {i} with additional information. " * 10
                f.write(content)
        
        engine = DocumentSearchEngine(
            index_dir=os.path.join(temp_data_dir, 'index'),
            json_mode=True
        )
        
        # Index the directory
        engine.index_directory(docs_dir)
        
        # Check statistics
        stats = engine.indexer.get_statistics()
        assert stats['total_documents'] >= 3
        assert stats['total_chunks'] >= 3
    
    def test_incremental_indexing(self, temp_data_dir):
        """Test incremental indexing with metadata store."""
        # Create test files
        docs_dir = os.path.join(temp_data_dir, 'docs')
        os.makedirs(docs_dir)
        
        with open(os.path.join(docs_dir, 'doc1.txt'), 'w') as f:
            # Write enough content to create chunks
            content = "Initial document content. " * 50
            f.write(content)
        
        engine = DocumentSearchEngine(
            index_dir=os.path.join(temp_data_dir, 'index'),
            json_mode=True,
            enable_incremental=True
        )
        
        # Initial indexing
        engine.index_directory_incremental(docs_dir)
        
        initial_stats = engine.indexer.get_statistics()
        initial_chunks = initial_stats['total_chunks']
        
        # Add another file
        with open(os.path.join(docs_dir, 'doc2.txt'), 'w') as f:
            # Write enough content to create chunks
            content = "Second document content. " * 50
            f.write(content)
        
        # Incremental indexing
        engine.index_directory_incremental(docs_dir)
        
        final_stats = engine.indexer.get_statistics()
        assert final_stats['total_chunks'] > initial_chunks
    
    def test_get_statistics(self, temp_data_dir):
        """Test getting index statistics."""
        engine = DocumentSearchEngine(
            index_dir=os.path.join(temp_data_dir, 'index'),
            json_mode=True
        )
        
        stats = engine.indexer.get_statistics()
        
        assert 'total_documents' in stats
        assert 'total_chunks' in stats
        assert 'index_size' in stats
        assert 'embedding_dimension' in stats
        assert stats['embedding_dimension'] > 0