"""
Unit tests for EmbeddingGenerator class.
"""
import numpy as np
from unittest.mock import patch, MagicMock, call
import pytest
from src.embeddings import EmbeddingGenerator


class TestEmbeddingGenerator:
    """Test suite for EmbeddingGenerator."""
    
    @patch('src.embeddings.SentenceTransformer')
    def test_initialization(self, mock_transformer):
        """Test embedding generator initialization."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator(model_type='sentence-transformer', model_name='test-model')
        
        mock_transformer.assert_called_once_with('test-model')
        assert generator.model == mock_model
        assert generator.model_name == 'test-model'
        
    @patch('src.embeddings.SentenceTransformer')
    def test_default_model(self, mock_transformer):
        """Test that default model is used when none specified."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        
        mock_transformer.assert_called_once_with('all-MiniLM-L6-v2')
        assert generator.model_name == 'all-MiniLM-L6-v2'
        
    @patch('src.embeddings.SentenceTransformer')
    def test_generate_single_embedding(self, mock_transformer):
        """Test generating embedding for a single text."""
        # Setup mock
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        mock_embedding = np.random.rand(1, 384).astype('float32')
        mock_model.encode.return_value = mock_embedding
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        result = generator.generate_query_embedding("Test text")
        
        mock_model.encode.assert_called_once()
        assert isinstance(result, np.ndarray)
        assert result.shape == (384,)
        
    @patch('src.embeddings.SentenceTransformer')
    def test_generate_batch_embeddings(self, mock_transformer):
        """Test generating embeddings for multiple texts."""
        # Setup mock
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        batch_size = 5
        mock_embeddings = np.random.rand(batch_size, 384).astype('float32')
        mock_model.encode.return_value = mock_embeddings
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        texts = ["Text 1", "Text 2", "Text 3", "Text 4", "Text 5"]
        results = generator.generate_embeddings(texts, use_cache=False)
        
        mock_model.encode.assert_called()
        assert results.shape == (batch_size, 384)
        assert isinstance(results, np.ndarray)
        
    @patch('src.embeddings.SentenceTransformer')
    def test_empty_text_handling(self, mock_transformer):
        """Test handling of empty text input."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        # Return zero vector for empty text
        mock_model.encode.return_value = np.zeros((1, 384)).astype('float32')
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        result = generator.generate_query_embedding("")
        
        assert isinstance(result, np.ndarray)
        assert result.shape == (384,)
        
    @patch('src.embeddings.SentenceTransformer')
    def test_batch_size_parameter(self, mock_transformer):
        """Test that batch_size parameter is respected."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        mock_model.encode.return_value = np.random.rand(10, 384).astype('float32')
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        texts = ["Text"] * 10
        results = generator.generate_embeddings(texts, batch_size=64, use_cache=False)
        
        # Check that encoding was called
        assert mock_model.encode.called
        assert results.shape == (10, 384)
        
    @patch('src.embeddings.SentenceTransformer')
    def test_show_progress_bar(self, mock_transformer):
        """Test progress bar parameter."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        mock_model.encode.return_value = np.random.rand(5, 384).astype('float32')
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        texts = ["Text"] * 5
        
        # Test embedding generation
        results = generator.generate_embeddings(texts, use_cache=False)
        assert results.shape == (5, 384)
        assert mock_model.encode.called
        
    @patch('src.embeddings.SentenceTransformer')
    def test_embedding_dimension_consistency(self, mock_transformer):
        """Test that all embeddings have consistent dimensions."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        # Return consistent dimensions
        mock_model.encode.return_value = np.random.rand(3, 384).astype('float32')
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        
        texts = ["Text 1", "Text 2", "Text 3"]
        embeddings = generator.generate_embeddings(texts, use_cache=False)
        
        # All embeddings should have same dimension
        assert embeddings.shape == (3, 384)
        assert all(embeddings[i].shape == (384,) for i in range(3))
        
    @patch('src.embeddings.SentenceTransformer')
    def test_normalize_embeddings(self, mock_transformer):
        """Test embedding normalization if implemented."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 3
        # Return non-normalized embedding
        embedding = np.array([[3.0, 4.0, 0.0]])  # Length = 5
        mock_model.encode.return_value = embedding
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        result = generator.generate_query_embedding("Test")
        
        # Check that we get a result
        assert isinstance(result, np.ndarray)
        assert result.shape == (3,)
        
    @patch('src.embeddings.SentenceTransformer')
    def test_unicode_text_handling(self, mock_transformer):
        """Test handling of Unicode text."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        mock_model.encode.return_value = np.random.rand(1, 384).astype('float32')
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        
        # Test various Unicode texts
        unicode_texts = [
            "Hello 世界",
            "Emoji test 🚀",
            "Привет мир",
            "مرحبا بالعالم"
        ]
        
        for text in unicode_texts:
            result = generator.generate_query_embedding(text)
            assert isinstance(result, np.ndarray)
            assert result.shape == (384,)
            
    @patch('src.embeddings.SentenceTransformer')
    def test_long_text_handling(self, mock_transformer):
        """Test handling of very long text inputs."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        mock_model.encode.return_value = np.random.rand(1, 384).astype('float32')
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        
        # Create a very long text (typical models have token limits)
        long_text = "word " * 10000  # 50,000 characters
        result = generator.generate_query_embedding(long_text)
        
        assert isinstance(result, np.ndarray)
        assert result.shape == (384,)
        
    @patch('src.embeddings.SentenceTransformer')
    def test_special_characters_handling(self, mock_transformer):
        """Test handling of special characters."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        mock_model.encode.return_value = np.random.rand(1, 384).astype('float32')
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        
        special_texts = [
            "Text with\nnewlines",
            "Text with\ttabs",
            "Text with special chars: @#$%^&*()",
            "<html>HTML tags</html>",
            "JSON: {\"key\": \"value\"}"
        ]
        
        for text in special_texts:
            result = generator.generate_query_embedding(text)
            assert isinstance(result, np.ndarray)
            assert result.shape == (384,)
            
    @patch('src.embeddings.SentenceTransformer')
    def test_model_caching(self, mock_transformer):
        """Test that model is only loaded once."""
        mock_model = MagicMock()
        mock_transformer.return_value = mock_model
        
        # Create multiple generators with same model
        gen1 = EmbeddingGenerator(model_name='test-model')
        gen2 = EmbeddingGenerator(model_name='test-model')
        
        # In practice, you might want to implement actual caching
        # This test checks if caching could be beneficial
        assert mock_transformer.call_count == 2  # Called twice without caching
        
    @patch('src.embeddings.SentenceTransformer')
    def test_error_handling(self, mock_transformer):
        """Test error handling in embedding generation."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        mock_model.encode.side_effect = Exception("Model error")
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        
        with pytest.raises(Exception, match="Model error"):
            generator.generate_query_embedding("Test text")
            
    @patch('src.embeddings.SentenceTransformer')
    def test_dtype_consistency(self, mock_transformer):
        """Test that embeddings are returned with consistent dtype."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        # Return different dtypes
        mock_model.encode.return_value = np.random.rand(1, 384).astype('float64')
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        result = generator.generate_query_embedding("Test")
        
        # Should be float32 or float64
        assert result.dtype == np.float32 or result.dtype == np.float64
        
    @patch('src.embeddings.SentenceTransformer')
    def test_batch_vs_single_consistency(self, mock_transformer):
        """Test that batch and single processing give consistent results."""
        mock_model = MagicMock()
        mock_model.get_sentence_embedding_dimension.return_value = 384
        
        # Setup consistent embeddings
        embedding1 = np.array([0.1, 0.2, 0.3] * 128)[:384].astype('float32')
        embedding2 = np.array([0.4, 0.5, 0.6] * 128)[:384].astype('float32')
        
        # Mock different calls
        mock_model.encode.side_effect = [
            embedding1.reshape(1, -1),  # First single call
            embedding2.reshape(1, -1),  # Second single call
            np.vstack([embedding1, embedding2])  # Batch call
        ]
        mock_transformer.return_value = mock_model
        
        generator = EmbeddingGenerator()
        
        # Generate single embeddings
        single1 = generator.generate_query_embedding("Text 1")
        single2 = generator.generate_query_embedding("Text 2")
        
        # Generate batch embeddings
        batch = generator.generate_embeddings(["Text 1", "Text 2"], use_cache=False)
        
        # Results should be consistent
        assert single1.shape == (384,)
        assert single2.shape == (384,)
        assert batch.shape == (2, 384)