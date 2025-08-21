"""
Shared pytest fixtures and configuration for all tests.
"""
import os
import sys
import tempfile
import shutil
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
import numpy as np

# Add src to path so we can import modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


@pytest.fixture
def temp_dir():
    """Create a temporary directory for testing."""
    temp_path = tempfile.mkdtemp()
    yield temp_path
    # Cleanup after test
    shutil.rmtree(temp_path, ignore_errors=True)


@pytest.fixture
def sample_text_file(temp_dir):
    """Create a sample text file for testing."""
    file_path = Path(temp_dir) / "sample.txt"
    content = """This is a sample text file for testing.
It contains multiple lines of text.
This helps test the document processing functionality."""
    file_path.write_text(content)
    return str(file_path)


@pytest.fixture
def sample_python_file(temp_dir):
    """Create a sample Python file for testing."""
    file_path = Path(temp_dir) / "sample.py"
    content = """# Sample Python file
def hello_world():
    print("Hello, World!")
    return True

if __name__ == "__main__":
    hello_world()
"""
    file_path.write_text(content)
    return str(file_path)


@pytest.fixture
def sample_html_file(temp_dir):
    """Create a sample HTML file for testing."""
    file_path = Path(temp_dir) / "sample.html"
    content = """<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
    <h1>Test Header</h1>
    <p>This is test content in HTML format.</p>
</body>
</html>"""
    file_path.write_text(content)
    return str(file_path)


@pytest.fixture
def sample_markdown_file(temp_dir):
    """Create a sample Markdown file for testing."""
    file_path = Path(temp_dir) / "README.md"
    content = """# Test Project

## Introduction
This is a test markdown file with various formatting.

## Features
- Feature 1
- Feature 2
- Feature 3

### Code Example
```python
print("Hello from markdown")
```
"""
    file_path.write_text(content)
    return str(file_path)


@pytest.fixture
def hidden_directory_structure(temp_dir):
    """Create a directory structure with hidden folders."""
    # Create visible directories
    visible_dir = Path(temp_dir) / "visible"
    visible_dir.mkdir()
    (visible_dir / "file1.txt").write_text("Visible file 1")
    (visible_dir / "file2.py").write_text("print('visible')")
    
    # Create hidden directory
    hidden_dir = Path(temp_dir) / ".hidden"
    hidden_dir.mkdir()
    (hidden_dir / "hidden1.txt").write_text("Hidden file 1")
    (hidden_dir / "hidden2.py").write_text("print('hidden')")
    
    # Create nested hidden
    nested_visible = visible_dir / "nested"
    nested_visible.mkdir()
    (nested_visible / "nested.txt").write_text("Nested visible")
    
    nested_hidden = visible_dir / ".nested_hidden"
    nested_hidden.mkdir()
    (nested_hidden / "nested_hidden.txt").write_text("Nested hidden")
    
    return temp_dir


@pytest.fixture
def mock_embeddings():
    """Mock embedding generator to avoid loading actual models."""
    with patch('src.embeddings.SentenceTransformer') as mock_model:
        # Mock the model to return consistent embeddings
        mock_instance = MagicMock()
        mock_instance.encode.return_value = np.random.rand(1, 384).astype('float32')
        mock_model.return_value = mock_instance
        yield mock_instance


@pytest.fixture
def sample_chunks():
    """Generate sample document chunks for testing."""
    from src.document_processor import DocumentChunk
    
    chunks = [
        DocumentChunk(
            content="This is the first chunk of text.",
            metadata={"file": "test1.txt", "chunk_index": 0},
            chunk_id="chunk_1",
            document_id="doc_1"
        ),
        DocumentChunk(
            content="This is the second chunk of text.",
            metadata={"file": "test1.txt", "chunk_index": 1},
            chunk_id="chunk_2",
            document_id="doc_1"
        ),
        DocumentChunk(
            content="This is from a different document.",
            metadata={"file": "test2.txt", "chunk_index": 0},
            chunk_id="chunk_3",
            document_id="doc_2"
        ),
    ]
    return chunks


@pytest.fixture
def mock_faiss_index():
    """Mock FAISS index for testing."""
    with patch('faiss.IndexFlatL2') as mock_index:
        instance = MagicMock()
        instance.d = 384  # Dimension
        instance.ntotal = 0
        instance.add = MagicMock(side_effect=lambda x: setattr(instance, 'ntotal', instance.ntotal + len(x)))
        instance.search = MagicMock(return_value=(
            np.array([[0.1, 0.2, 0.3]]),  # Distances
            np.array([[0, 1, 2]])  # Indices
        ))
        mock_index.return_value = instance
        yield instance


@pytest.fixture
def test_config():
    """Test configuration."""
    return {
        'chunk_size': 500,
        'chunk_overlap': 50,
        'embedding_model': 'all-MiniLM-L6-v2',
        'index_path': './test_index',
        'batch_size': 32,
        'num_workers': 2
    }


@pytest.fixture
def binary_files(temp_dir):
    """Create binary files that should not be processed."""
    # Create a fake .class file
    class_file = Path(temp_dir) / "Test.class"
    class_file.write_bytes(b'\xCA\xFE\xBA\xBE' + b'\x00' * 100)  # Java class magic number
    
    # Create a fake image file
    jpg_file = Path(temp_dir) / "image.jpg"
    jpg_file.write_bytes(b'\xFF\xD8\xFF\xE0' + b'\x00' * 100)  # JPEG magic number
    
    # Create a fake gif file
    gif_file = Path(temp_dir) / "image.gif"
    gif_file.write_bytes(b'GIF89a' + b'\x00' * 100)
    
    return {
        'class': str(class_file),
        'jpg': str(jpg_file),
        'gif': str(gif_file)
    }


@pytest.fixture
def special_filenames(temp_dir):
    """Create files with special names (no extensions)."""
    files = {}
    special_names = ['Makefile', 'Dockerfile', 'README', 'LICENSE']
    
    for name in special_names:
        file_path = Path(temp_dir) / name
        file_path.write_text(f"Content of {name}")
        files[name] = str(file_path)
    
    return files


# Pytest configuration
def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line(
        "markers", "slow: marks tests as slow (deselect with '-m \"not slow\"')"
    )
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests"
    )
    config.addinivalue_line(
        "markers", "unit: marks tests as unit tests"
    )