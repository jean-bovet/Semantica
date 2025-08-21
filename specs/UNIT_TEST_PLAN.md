# Unit Test Plan for Local Document Search Engine

## Overview
This document outlines a comprehensive unit testing strategy for the Python-based local document search engine. The tests will ensure reliability, maintainability, and correctness of all components.

## Testing Framework
- **Primary Framework**: pytest (industry standard, great fixtures support)
- **Mocking**: unittest.mock and pytest-mock
- **Coverage**: pytest-cov (aim for >80% coverage)
- **Test Data**: pytest-datadir for test files
- **Async Testing**: pytest-asyncio (if needed)

## Test Structure
```
local-doc-search/
├── tests/
│   ├── __init__.py
│   ├── conftest.py                 # Shared fixtures
│   ├── test_document_processor.py
│   ├── test_embeddings.py
│   ├── test_indexer.py
│   ├── test_search.py
│   ├── test_metadata_store.py
│   ├── test_cli.py
│   ├── fixtures/                   # Test data files
│   │   ├── sample.pdf
│   │   ├── sample.docx
│   │   ├── sample.txt
│   │   ├── sample.py
│   │   ├── sample.html
│   │   └── sample_hidden/.hidden.txt
│   └── integration/
│       └── test_end_to_end.py
```

## Component Test Plans

### 1. DocumentProcessor Tests (`test_document_processor.py`)

#### Test Categories:
1. **File Type Detection**
   - ✅ Test supported extensions recognition
   - ✅ Test case-insensitive extension matching
   - ✅ Test special filenames without extensions
   - ✅ Test unsupported file rejection

2. **File Processing**
   - ✅ Test PDF text extraction
   - ✅ Test DOCX text extraction
   - ✅ Test plain text file reading
   - ✅ Test various code file formats
   - ✅ Test Unicode/encoding handling
   - ✅ Test empty file handling
   - ✅ Test corrupted file handling

3. **Directory Processing**
   - ✅ Test recursive directory scanning
   - ✅ Test hidden directory filtering
   - ✅ Test file counting and progress
   - ✅ Test multi-threaded processing
   - ✅ Test empty directory handling

4. **Chunking Logic**
   - ✅ Test chunk size limits
   - ✅ Test chunk overlap
   - ✅ Test metadata preservation
   - ✅ Test chunk ID generation

5. **Incremental Processing**
   - ✅ Test new file detection
   - ✅ Test modified file detection
   - ✅ Test deleted file handling
   - ✅ Test unchanged file skipping

#### Sample Tests:
```python
def test_supported_extensions():
    processor = DocumentProcessor()
    assert '.py' in processor.supported_extensions
    assert '.html' in processor.supported_extensions
    assert '.exe' not in processor.supported_extensions

def test_hidden_directory_filtering():
    processor = DocumentProcessor()
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create hidden and normal directories
        os.makedirs(f"{tmpdir}/.hidden")
        os.makedirs(f"{tmpdir}/visible")
        # Add files and test filtering
        
def test_chunk_generation():
    processor = DocumentProcessor(chunk_size=100, chunk_overlap=20)
    chunks = processor._create_chunks("x" * 250, {"file": "test.txt"})
    assert len(chunks) == 3
    assert all(len(c.content) <= 100 for c in chunks)
```

### 2. Embeddings Tests (`test_embeddings.py`)

#### Test Categories:
1. **Model Loading**
   - ✅ Test model initialization
   - ✅ Test fallback to CPU if no GPU
   - ✅ Test model caching
   - ✅ Test invalid model handling

2. **Embedding Generation**
   - ✅ Test single text embedding
   - ✅ Test batch embedding
   - ✅ Test empty text handling
   - ✅ Test dimension consistency
   - ✅ Test normalization

3. **Performance**
   - ✅ Test batch size optimization
   - ✅ Test memory usage
   - ✅ Test parallel processing

#### Sample Tests:
```python
def test_embedding_dimensions():
    embedder = EmbeddingGenerator()
    embedding = embedder.generate_embedding("test text")
    assert embedding.shape[0] == 384  # Expected dimension
    
def test_batch_processing():
    embedder = EmbeddingGenerator()
    texts = ["text1", "text2", "text3"]
    embeddings = embedder.generate_embeddings_batch(texts)
    assert len(embeddings) == 3
    assert all(e.shape[0] == 384 for e in embeddings)
```

### 3. Indexer Tests (`test_indexer.py`)

#### Test Categories:
1. **Index Creation**
   - ✅ Test new index creation
   - ✅ Test index directory structure
   - ✅ Test index metadata storage

2. **FAISS Operations**
   - ✅ Test vector addition
   - ✅ Test index saving/loading
   - ✅ Test index merging
   - ✅ Test index size limits

3. **Document Management**
   - ✅ Test document ID mapping
   - ✅ Test duplicate handling
   - ✅ Test document removal

#### Sample Tests:
```python
def test_index_creation():
    with tempfile.TemporaryDirectory() as tmpdir:
        indexer = Indexer(index_path=tmpdir)
        assert indexer.index is not None
        assert indexer.index.ntotal == 0
        
def test_add_vectors():
    indexer = Indexer()
    vectors = np.random.rand(5, 384).astype('float32')
    doc_ids = ["doc1", "doc2", "doc3", "doc4", "doc5"]
    indexer.add_vectors(vectors, doc_ids)
    assert indexer.index.ntotal == 5
```

### 4. Search Engine Tests (`test_search.py`)

#### Test Categories:
1. **Search Operations**
   - ✅ Test basic search
   - ✅ Test similarity scoring
   - ✅ Test result ranking
   - ✅ Test result limit
   - ✅ Test empty query handling

2. **Index Management**
   - ✅ Test index loading
   - ✅ Test index clearing
   - ✅ Test statistics generation

3. **Integration**
   - ✅ Test full indexing pipeline
   - ✅ Test incremental indexing
   - ✅ Test search after indexing

#### Sample Tests:
```python
def test_search_results():
    engine = SearchEngine()
    # Index some test documents
    results = engine.search("test query", limit=5)
    assert len(results) <= 5
    assert all(hasattr(r, 'score') for r in results)
    
def test_index_statistics():
    engine = SearchEngine()
    stats = engine.get_statistics()
    assert 'total_documents' in stats
    assert 'total_chunks' in stats
```

### 5. Metadata Store Tests (`test_metadata_store.py`)

#### Test Categories:
1. **Database Operations**
   - ✅ Test database creation
   - ✅ Test schema initialization
   - ✅ Test connection management

2. **File Tracking**
   - ✅ Test file info storage
   - ✅ Test file status detection
   - ✅ Test modification tracking
   - ✅ Test deletion detection

3. **Change Detection**
   - ✅ Test new file detection
   - ✅ Test modified file detection
   - ✅ Test unchanged file detection

#### Sample Tests:
```python
def test_file_tracking():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = MetadataStore(f"{tmpdir}/test.db")
        store.add_file("/path/to/file.txt", "hash123", 100, 1234567890)
        status, info = store.get_file_status("/path/to/file.txt")
        assert status == 'unchanged'
        assert info.content_hash == "hash123"
        
def test_change_detection():
    store = MetadataStore()
    changes = store.get_changed_files("/test/dir")
    assert hasattr(changes, 'new_files')
    assert hasattr(changes, 'modified_files')
```

### 6. CLI Tests (`test_cli.py`)

#### Test Categories:
1. **Command Parsing**
   - ✅ Test index command
   - ✅ Test search command
   - ✅ Test stats command
   - ✅ Test clear command

2. **JSON Mode**
   - ✅ Test JSON input parsing
   - ✅ Test JSON output format
   - ✅ Test error handling in JSON mode

3. **Interactive Mode**
   - ✅ Test command loop
   - ✅ Test exit handling

#### Sample Tests:
```python
def test_index_command():
    runner = CliRunner()
    with tempfile.TemporaryDirectory() as tmpdir:
        result = runner.invoke(cli, ['index', '--folder', tmpdir])
        assert result.exit_code == 0
        
def test_json_mode():
    runner = CliRunner()
    result = runner.invoke(cli, ['--json-mode'], 
                          input='{"action": "stats"}\n{"action": "exit"}')
    assert result.exit_code == 0
    assert '"success": true' in result.output
```

## Test Fixtures and Mocks

### Common Fixtures (`conftest.py`)
```python
@pytest.fixture
def sample_documents():
    """Create temporary test documents"""
    
@pytest.fixture
def mock_embeddings():
    """Mock embedding generator to avoid loading models"""
    
@pytest.fixture
def temp_index():
    """Create temporary index for testing"""
    
@pytest.fixture
def sample_chunks():
    """Generate sample document chunks"""
```

## Coverage Goals
- **Minimum Coverage**: 80% overall
- **Critical Components**: 90%+ for core functionality
- **Focus Areas**:
  - Document processing logic
  - Search algorithm
  - Index management
  - Error handling paths

## CI/CD Integration
```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
      - run: pip install -r requirements.txt pytest pytest-cov
      - run: pytest --cov=src --cov-report=html
```

## Performance Testing
- Benchmark indexing speed (docs/minute)
- Benchmark search latency (ms)
- Memory usage profiling
- Concurrent operation testing

## Edge Cases to Test
1. Very large files (>100MB)
2. Files with special characters in names
3. Deeply nested directory structures
4. Symbolic links and circular references
5. Permission denied scenarios
6. Disk full conditions
7. Concurrent indexing operations
8. Corrupted index recovery

## Test Data Management
- Use small, representative test files
- Mock external dependencies (ML models)
- Use in-memory databases for speed
- Clean up temporary files after tests

## Running Tests
```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html

# Run specific test file
pytest tests/test_document_processor.py

# Run with verbose output
pytest -v

# Run only marked tests
pytest -m "not slow"
```

## Next Steps
1. Set up pytest and required plugins
2. Create test directory structure
3. Implement fixtures and mocks
4. Write tests module by module
5. Set up CI pipeline
6. Add pre-commit hooks for testing