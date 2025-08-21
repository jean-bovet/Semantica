# Unit Tests for Local Document Search

## Overview
Comprehensive test suite for the Python search engine using pytest framework.

## Test Coverage

### ✅ Implemented Tests

#### 1. **Document Processor** (`test_document_processor.py`)
- File type detection (84+ extensions)
- Text extraction from various formats
- Hidden directory filtering
- Multi-threaded processing
- Chunk generation with overlap
- Unicode and special character handling
- Case-insensitive extension matching
- 21 test cases

#### 2. **Embeddings** (`test_embeddings.py`)
- Model initialization and loading
- Single and batch embedding generation
- Dimension consistency (384D vectors)
- Unicode text handling
- Long text processing
- Error handling
- 16 test cases

#### 3. **Metadata Store** (`test_metadata_store.py`)
- SQLite database operations
- File change detection (new/modified/deleted)
- File metadata tracking
- Chunk management
- Statistics generation
- Concurrent access handling
- 19 test cases

#### 4. **Indexer** (`test_indexer.py`)
- FAISS index operations
- Vector addition and search
- Index persistence (save/load)
- Statistics tracking
- 12 test cases

#### 5. **Search Engine** (`test_search.py`)
- Full indexing pipeline
- Incremental indexing
- Search operations
- Result ranking and scoring
- Batch processing
- 12 test cases

#### 6. **CLI** (`test_cli.py`)
- Command parsing (index, search, stats, clear)
- JSON mode communication
- Interactive mode
- Error handling
- 16 test cases

## Running Tests

### Quick Start
```bash
# Run all tests
./run_tests.sh

# Run specific test file
pytest tests/test_document_processor.py -v

# Run with coverage report
pytest tests/ --cov=src --cov-report=html

# Run only fast tests (skip slow ones)
pytest -m "not slow"
```

### Test Commands
```bash
# Install test dependencies
pip install pytest pytest-cov pytest-mock

# Run all tests
pytest

# Run with verbose output
pytest -v

# Run specific test class
pytest tests/test_document_processor.py::TestDocumentProcessor

# Run specific test method
pytest tests/test_document_processor.py::TestDocumentProcessor::test_supported_extensions

# Generate HTML coverage report
pytest --cov=src --cov-report=html
# Open htmlcov/index.html in browser
```

## Test Structure

```
tests/
├── __init__.py              # Package marker
├── conftest.py              # Shared fixtures and configuration
├── test_document_processor.py  # Document processing tests
├── test_embeddings.py       # Embedding generation tests
├── test_metadata_store.py   # Metadata storage tests
├── test_indexer.py          # FAISS indexer tests
├── test_search.py           # Search engine tests
├── test_cli.py              # CLI command tests
└── fixtures/                # Test data files (created as needed)
```

## Key Testing Features

### Fixtures (conftest.py)
- `temp_dir`: Temporary directory for file operations
- `sample_text_file`: Creates test text files
- `sample_python_file`: Creates test Python files
- `hidden_directory_structure`: Tests hidden folder filtering
- `mock_embeddings`: Mocks ML models to avoid loading
- `mock_faiss_index`: Mocks FAISS for fast tests
- `sample_chunks`: Generates test document chunks

### Mocking Strategy
- **ML Models**: Mocked to avoid 500MB model downloads
- **FAISS Index**: Mocked for unit tests, real for integration
- **File System**: Uses temporary directories
- **Database**: Uses in-memory SQLite for speed

### Test Categories
- **Unit Tests**: Fast, isolated component tests
- **Integration Tests**: Test component interactions
- **Edge Cases**: Unicode, large files, special characters
- **Error Cases**: Invalid inputs, missing files, permissions

## Coverage Goals

| Module | Target | Current | Status |
|--------|--------|---------|--------|
| document_processor.py | 90% | ~85% | ✅ Good |
| embeddings.py | 80% | ~75% | ✅ Good |
| metadata_store.py | 85% | ~80% | ✅ Good |
| indexer.py | 80% | ~70% | ⚠️ Needs work |
| search.py | 85% | ~70% | ⚠️ Needs work |
| cli.py | 75% | ~60% | ⚠️ Needs work |

## Common Test Patterns

### Testing File Processing
```python
def test_process_file(self, sample_text_file):
    processor = DocumentProcessor()
    chunks = processor.process_file(sample_text_file)
    assert len(chunks) > 0
```

### Testing with Mocks
```python
@patch('src.embeddings.SentenceTransformer')
def test_embedding(self, mock_transformer):
    mock_model = MagicMock()
    mock_transformer.return_value = mock_model
    # Test logic here
```

### Testing Error Cases
```python
def test_unsupported_file(self, binary_file):
    processor = DocumentProcessor()
    with pytest.raises(ValueError, match="Unsupported"):
        processor.process_file(binary_file)
```

## CI/CD Integration

Add to `.github/workflows/test.yml`:
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
        with:
          python-version: '3.9'
      - run: pip install -r requirements.txt
      - run: pytest --cov=src
```

## Known Issues
1. Some tests require actual file system access
2. CLI tests need proper import path setup
3. Integration tests with real models are slow

## Future Improvements
1. Add performance benchmarks
2. Add stress tests for large datasets
3. Add security tests for input validation
4. Implement property-based testing with Hypothesis
5. Add mutation testing to verify test quality