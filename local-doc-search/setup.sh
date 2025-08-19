#!/bin/bash

echo "================================================"
echo "Local Document Search Engine - Setup Script"
echo "================================================"

# Check Python version
echo -e "\n1. Checking Python version..."
python_version=$(python3 --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
required_version="3.9"

if [ "$(printf '%s\n' "$required_version" "$python_version" | sort -V | head -n1)" = "$required_version" ]; then 
    echo "✓ Python $python_version is installed (requires 3.9+)"
else
    echo "✗ Python $python_version is too old. Please install Python 3.9 or higher"
    exit 1
fi

# Create virtual environment
echo -e "\n2. Creating virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "✓ Virtual environment created"
else
    echo "✓ Virtual environment already exists"
fi

# Activate virtual environment
echo -e "\n3. Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo -e "\n4. Upgrading pip..."
pip install --upgrade pip --quiet

# Install dependencies
echo -e "\n5. Installing dependencies..."
pip install -r requirements.txt

# Create necessary directories
echo -e "\n6. Creating data directories..."
mkdir -p data/documents data/index data/embeddings_cache
echo "✓ Directories created"

# Check for Ollama (optional)
echo -e "\n7. Checking for Ollama (optional)..."
if command -v ollama &> /dev/null; then
    echo "✓ Ollama is installed"
    echo "  To use Ollama embeddings, run: ollama pull nomic-embed-text"
else
    echo "ℹ Ollama not found (optional - only needed for Ollama embeddings)"
fi

echo -e "\n================================================"
echo "Setup complete!"
echo "================================================"
echo ""
echo "To get started:"
echo "1. Activate the virtual environment: source venv/bin/activate"
echo "2. Add some documents to index: python cli.py index --folder /path/to/documents"
echo "3. Search your documents: python cli.py search 'your query'"
echo "4. Or start interactive mode: python cli.py interactive"
echo ""
echo "For more help: python cli.py --help"