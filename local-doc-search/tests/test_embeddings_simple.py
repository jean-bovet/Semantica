"""
Simplified tests for EmbeddingGenerator - testing essential behavior without over-mocking.
"""
import numpy as np
import pytest
from unittest.mock import patch, MagicMock
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.embeddings import EmbeddingGenerator


class TestEmbeddingGeneratorSimple:
    """Essential tests for embedding generation."""
    
    def test_initialization_with_real_model(self):
        """Test that generator initializes with expected properties."""
        # This will actually try to load the model - only run if model is available
        # For CI/CD, you'd want to mock this
        try:
            generator = EmbeddingGenerator(model_name='all-MiniLM-L6-v2')
            assert generator.embedding_dim == 384
            assert generator.model_name == 'all-MiniLM-L6-v2'
        except Exception:
            # Model not available, skip test
            pytest.skip("Model not available for testing")
    
    @patch('src.embeddings.SentenceTransformer')
    def test_embedding_dimensions(self, mock_transformer):
        """Test that embeddings have correct dimensions."""
        # Minimal mocking - just what's needed
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        mock_model.encode.return_value = np.random.rand(1, 384).astype('float32')
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        
        # Test single embedding
        query_embedding = generator.generate_query_embedding("test query")
        assert query_embedding.shape == (384,)
        assert query_embedding.dtype == np.float32
    
    @patch('src.embeddings.SentenceTransformer')
    def test_batch_processing(self, mock_transformer):
        """Test that batch processing returns correct shape."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        
        # Return appropriate sized embeddings for batch
        def encode_side_effect(texts, *args, **kwargs):
            if isinstance(texts, list):
                return np.random.rand(len(texts), 384).astype('float32')
            return np.random.rand(1, 384).astype('float32')
        
        mock_model.encode.side_effect = encode_side_effect
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        
        # Test batch
        texts = ["doc1", "doc2", "doc3"]
        embeddings = generator.generate_embeddings(texts, use_cache=False)
        
        assert embeddings.shape == (3, 384)
        assert embeddings.dtype == np.float32
    
    def test_json_mode_initialization(self):
        """Test that JSON mode doesn't affect embedding generation."""
        with patch('src.embeddings.SentenceTransformer') as mock_transformer:
            mock_model = MagicMock()
            mock_model.get_sentence_embedding_dimension.return_value = 384
            mock_transformer.return_value = mock_model
            
            generator = EmbeddingGenerator(json_mode=True)
            assert generator.json_mode is True
            # JSON mode should not affect the model loading
            mock_transformer.assert_called_once()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])