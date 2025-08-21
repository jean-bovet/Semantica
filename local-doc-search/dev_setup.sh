#!/bin/bash
# Development setup script - configures environment for clean development

echo "🔧 Development Environment Setup"
echo "================================"
echo ""

# 1. Set Python to not create __pycache__ directories
echo "1. Configuring Python to minimize artifacts..."
echo ""
echo "To prevent __pycache__ creation, add to your shell profile:"
echo "  export PYTHONDONTWRITEBYTECODE=1"
echo ""
echo "Or run this session with:"
echo "  PYTHONDONTWRITEBYTECODE=1 python3 cli.py"
echo ""

# 2. Check for and warn about virtual environment
if [ -d "venv" ] || [ -d "env" ] || [ -d ".venv" ]; then
    echo "⚠️  WARNING: Virtual environment detected!"
    echo "Per project requirements, use system Python instead:"
    echo "  python3 (not venv/bin/python)"
    echo ""
    echo "Run ./clean.sh to remove virtual environment"
    echo ""
fi

# 3. Create necessary directories (that should exist)
echo "2. Creating necessary directories..."
mkdir -p src
mkdir -p tests
echo "   ✅ Source directories ready"

# 4. Check Python version
echo ""
echo "3. Checking Python version..."
PYTHON_VERSION=$(python3 --version 2>&1)
echo "   Found: $PYTHON_VERSION"

MIN_VERSION="3.9"
CURRENT_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')

if [ "$(printf '%s\n' "$MIN_VERSION" "$CURRENT_VERSION" | sort -V | head -n1)" = "$MIN_VERSION" ]; then
    echo "   ✅ Python version OK (>= 3.9)"
else
    echo "   ⚠️  Python version may be too old (need >= 3.9)"
fi

# 5. Show how to run without creating artifacts
echo ""
echo "4. Clean Development Commands:"
echo "------------------------------"
echo ""
echo "Run CLI without creating __pycache__:"
echo "  PYTHONDONTWRITEBYTECODE=1 python3 cli.py"
echo ""
echo "Run tests without creating __pycache__:"
echo "  PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/"
echo ""
echo "Or set permanently in your shell:"
echo "  echo 'export PYTHONDONTWRITEBYTECODE=1' >> ~/.zshrc"
echo "  source ~/.zshrc"
echo ""

# 6. Git status check
echo "5. Checking git status..."
if command -v git &> /dev/null; then
    UNTRACKED=$(git ls-files --others --exclude-standard | wc -l | tr -d ' ')
    if [ "$UNTRACKED" -gt 0 ]; then
        echo "   ⚠️  Found $UNTRACKED untracked files"
        echo "   Run 'git status' to review"
        echo "   Run './clean.sh' to remove artifacts"
    else
        echo "   ✅ Working directory clean"
    fi
fi

echo ""
echo "================================"
echo "✨ Setup complete!"
echo ""
echo "Quick reference:"
echo "  ./clean.sh           - Remove all artifacts"
echo "  ./run_tests.sh       - Run test suite"
echo "  python3 cli.py       - Run the CLI (use system Python!)"