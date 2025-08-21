#!/bin/bash
# Script to run tests for the local document search engine

echo "Running unit tests for Local Document Search..."
echo "=============================================="

# Activate virtual environment
source venv/bin/activate

# Run tests with coverage
echo "Running Document Processor tests..."
python -m pytest tests/test_document_processor.py -v --tb=short

echo ""
echo "Running Metadata Store tests..."
python -m pytest tests/test_metadata_store.py -v --tb=short

echo ""
echo "Running Embeddings tests (with mocks)..."
python -m pytest tests/test_embeddings.py -v --tb=short

echo ""
echo "Summary Report:"
echo "==============="
python -m pytest tests/test_document_processor.py tests/test_metadata_store.py tests/test_embeddings.py --cov=src --cov-report=term-missing --quiet

echo ""
echo "To run all tests: pytest tests/"
echo "To run with coverage: pytest tests/ --cov=src --cov-report=html"