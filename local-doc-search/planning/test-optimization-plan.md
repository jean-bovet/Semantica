# Test Suite Optimization Plan

## Current State Analysis
- **Total Tests**: 94 passing
- **Execution Time**: ~100 seconds (1m 40s)
- **Code Coverage**: 64%
- **Main Bottleneck**: ML model loading (174MB HuggingFace cache)

## Performance Issues Identified

### 1. Model Loading Overhead (Critical)
**Problem**: Each test creates new DocumentSearchEngine instance, loading ML model from disk
- **Impact**: ~2 seconds per test × 17 tests = 34+ seconds
- **Affected Files**:
  - `test_search.py`: 7 tests, each loads model
  - `test_async_cli.py`: 10 tests, fixture loads model per test
  - `test_embeddings_simple.py`: 3 tests with real models

### 2. Slowest Tests (Top 10)
```
2.38s test_search.py::test_index_directory
2.27s test_search.py::test_incremental_indexing  
2.24s test_cli_unittest.py::test_search_empty_query
2.03s test_async_cli.py::test_clear_index (setup)
2.02s test_search.py::test_get_statistics
2.02s test_search.py::test_clear_index
1.96s test_async_cli.py::test_initialization (setup)
1.94s test_search.py::test_add_document_and_search
1.91s test_search.py::test_search_empty_query
1.89s test_async_cli.py::test_process_invalid_json (setup)
```

## Coverage Gaps

### Low Coverage Files
| File | Coverage | Missing Features |
|------|----------|-----------------|
| `embeddings.py` | 46% | Ollama integration, error handling, model fallbacks |
| `search.py` | 51% | Display methods, similar documents, get_similar_documents |
| `indexer.py` | 64% | IVFFlat index, remove/update operations, load errors |

### Untested Features
- Ollama embedding generator
- Rich console display outputs
- Document removal (`remove_document`)
- Index updates (`update_vectors`)
- Error recovery paths
- Configuration file loading
- Concurrent processing edge cases

## Optimization Strategy

### Phase 1: Quick Wins (1-2 hours)
1. **Session-scoped Model Loading**
   ```python
   @pytest.fixture(scope="session")
   def shared_engine():
       """Load model once for entire test session"""
       return DocumentSearchEngine(json_mode=True)
   ```

2. **Mock Heavy Operations**
   - Mock `EmbeddingGenerator` in unit tests
   - Use pre-computed embeddings (numpy arrays)
   - Mock FAISS operations where possible

3. **Combine Redundant Tests**
   - Merge `test_cli_unittest.py` into `test_async_cli.py`
   - Consolidate initialization tests

### Phase 2: Test Reorganization (2-3 hours)
1. **Separate Test Types**
   ```
   tests/
   ├── unit/           # Fast, mocked tests
   │   ├── test_document_processor.py
   │   ├── test_indexer.py
   │   └── test_metadata_store.py
   ├── integration/    # Real components, slower
   │   ├── test_search_engine.py
   │   ├── test_cli_integration.py
   │   └── test_embeddings_real.py
   └── fixtures/       # Shared fixtures
       └── conftest.py
   ```

2. **Test Markers**
   ```python
   @pytest.mark.slow  # Tests taking >1 second
   @pytest.mark.integration  # Tests using real models
   @pytest.mark.unit  # Fast, mocked tests
   ```

3. **Test Commands**
   ```bash
   # Fast tests only (for development)
   pytest -m "not slow"
   
   # Full suite
   pytest
   
   # Parallel execution
   pytest -n auto
   ```

### Phase 3: Coverage Improvements (3-4 hours)
1. **Add Missing Tests**
   - Error handling paths
   - Display/output methods
   - Configuration loading
   - Edge cases (empty index, corrupt files)

2. **Mock Strategy for New Tests**
   - Use `unittest.mock` for external dependencies
   - Create fixture for fake embeddings
   - Mock file I/O operations

### Phase 4: Performance Enhancements (2-3 hours)
1. **Parallel Execution**
   ```bash
   pip install pytest-xdist
   pytest -n 4  # Run on 4 cores
   ```

2. **Test Data Optimization**
   - Pre-generate test embeddings
   - Use smaller test documents
   - Cache test indices

3. **Fixture Optimization**
   ```python
   @pytest.fixture(scope="module")
   def test_index():
       """Reuse index across tests in module"""
   
   @pytest.fixture
   def mock_embeddings():
       """Return pre-computed embeddings"""
       return np.random.rand(10, 384).astype('float32')
   ```

## Implementation Priority

### High Priority (Do First)
1. Add session-scoped fixture for DocumentSearchEngine
2. Mock EmbeddingGenerator in unit tests
3. Separate slow integration tests from fast unit tests
4. Add pytest markers for test categories

### Medium Priority
1. Improve test coverage for low-coverage files
2. Add error handling tests
3. Consolidate redundant tests
4. Implement parallel test execution

### Low Priority
1. Optimize test data generation
2. Add performance benchmarks
3. Create test documentation
4. Set up CI/CD test categories

## Expected Outcomes

### Performance Goals
- **Unit tests**: < 10 seconds
- **Integration tests**: < 30 seconds  
- **Full suite**: < 45 seconds (from 100s)
- **Development cycle**: Run unit tests in < 5s

### Coverage Goals
- Overall coverage: 80%+ (from 64%)
- Critical paths: 95%+ coverage
- Error handling: 90%+ coverage

## Testing Commands

```bash
# Run only fast unit tests
pytest tests/unit -m "not slow"

# Run integration tests
pytest tests/integration

# Run with coverage
pytest --cov=src --cov-report=html

# Run in parallel
pytest -n auto

# Run specific markers
pytest -m "not integration"  # Skip integration tests
pytest -m slow  # Only slow tests
```

## Files to Create/Modify

1. **Create**: `tests/fixtures/conftest.py` - Shared fixtures
2. **Create**: `tests/unit/` directory - Fast tests
3. **Create**: `tests/integration/` directory - Slow tests
4. **Modify**: `pytest.ini` - Add markers and test paths
5. **Create**: `tests/fixtures/test_data.py` - Pre-computed test data

## Success Metrics

1. **Speed**: Test suite runs in < 45 seconds
2. **Coverage**: Achieve 80%+ code coverage
3. **Reliability**: No flaky tests
4. **Developer Experience**: Unit tests run in < 5 seconds
5. **CI/CD**: Separate fast/slow test pipelines

## Notes

- Current bottleneck is ML model loading (Sentence Transformers)
- 174MB HuggingFace cache is loaded multiple times
- AsyncCLI fixture is particularly expensive (2s per test setup)
- Some tests could be converted to use mocked components
- Consider using smaller test models (e.g., mock embeddings of dimension 10 instead of 384)