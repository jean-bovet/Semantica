#!/bin/bash
# Run essential tests for the local document search engine

echo "Running Essential Tests for Local Document Search"
echo "=================================================="
echo ""

# Use virtual environment for testing
VENV_DIR="test_venv"

# Create or activate virtual environment
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment for testing..."
    python3 -m venv $VENV_DIR
    source $VENV_DIR/bin/activate
    
    echo "Installing test dependencies..."
    pip install --quiet --upgrade pip
    pip install --quiet pytest pytest-asyncio pytest-cov
    
    echo "Installing project dependencies..."
    if [ -f "requirements.txt" ]; then
        pip install --quiet -r requirements.txt
    fi
    echo "✅ Virtual environment created and dependencies installed"
else
    echo "Using existing virtual environment..."
    source $VENV_DIR/bin/activate
fi

# Use venv Python
PYTHON="python"

# Verify pytest is available
if $PYTHON -c "import pytest" 2>/dev/null; then
    PYTEST_AVAILABLE=true
    echo "✅ pytest is installed"
else
    PYTEST_AVAILABLE=false
    echo "❌ pytest not available"
    exit 1
fi

echo ""
echo "Running all tests with pytest..."
echo "================================"
echo ""

# Add src to Python path
export PYTHONPATH="${PYTHONPATH}:$(pwd):$(pwd)/src"

# Run all tests with coverage
$PYTHON -m pytest tests/ -v --tb=short \
    --cov=src \
    --cov-report=term-missing \
    --cov-report=html:htmlcov

TEST_EXIT_CODE=$?

echo ""
echo "=================================================="
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "✅ All tests passed!"
else
    echo "❌ Some tests failed (exit code: $TEST_EXIT_CODE)"
fi

echo ""
echo "Test Results:"
echo "  - Coverage report: htmlcov/index.html"
echo "  - Virtual environment: $VENV_DIR/"
echo ""
echo "To run tests again:"
echo "  ./run_tests.sh"
echo ""
echo "To run specific test:"
echo "  source $VENV_DIR/bin/activate"
echo "  python -m pytest tests/test_metadata_store.py -v"
echo ""
echo "To deactivate virtual environment:"
echo "  deactivate"

# Return the test exit code
exit $TEST_EXIT_CODE