#!/bin/bash
# Clean up development artifacts and temporary files

echo "🧹 Cleaning up development artifacts..."
echo "========================================"
echo ""

# Counter for removed items
REMOVED_COUNT=0

# Function to safely remove directories/files
safe_remove() {
    local path=$1
    local type=$2
    if [ -e "$path" ]; then
        rm -rf "$path"
        echo "✅ Removed $type: $path"
        ((REMOVED_COUNT++))
    fi
}

# 1. Remove Python cache directories
echo "1. Cleaning Python cache directories..."
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null
find . -type f -name "*.pyc" -delete 2>/dev/null
find . -type f -name "*.pyo" -delete 2>/dev/null
find . -type f -name "*.pyd" -delete 2>/dev/null
find . -type f -name ".Python" -delete 2>/dev/null
echo "   ✅ Python caches cleaned"

# 2. Remove virtual environment (should NOT exist per your instructions!)
echo ""
echo "2. Checking for virtual environment..."
if [ -d "venv" ]; then
    echo "   ⚠️  Found venv directory (should not exist!)"
    read -p "   Remove venv directory? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        safe_remove "venv" "virtual environment"
    fi
else
    echo "   ✅ No venv directory found (good!)"
fi

# Also check for other common venv names
for venv_name in env ENV .venv .env; do
    if [ -d "$venv_name" ]; then
        echo "   ⚠️  Found $venv_name directory"
        safe_remove "$venv_name" "virtual environment"
    fi
done

# 3. Remove test artifacts
echo ""
echo "3. Cleaning test artifacts..."
safe_remove ".pytest_cache" "pytest cache"
safe_remove ".coverage" "coverage file"
safe_remove "htmlcov" "coverage HTML report"
safe_remove ".tox" "tox directory"
find . -type f -name ".coverage.*" -delete 2>/dev/null

# 4. Remove data directory (contains index and cache)
echo ""
echo "4. Checking data directory..."
if [ -d "data" ]; then
    echo "   ⚠️  Found data directory with index/cache"
    read -p "   Remove data directory (will clear all indexes)? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        safe_remove "data" "data directory"
    else
        echo "   Kept data directory"
    fi
else
    echo "   No data directory found"
fi

# 5. Remove build artifacts
echo ""
echo "5. Cleaning build artifacts..."
safe_remove "build" "build directory"
safe_remove "dist" "dist directory"
safe_remove ".eggs" "eggs directory"
find . -type d -name "*.egg" -exec rm -rf {} + 2>/dev/null

# 6. Remove IDE and editor files
echo ""
echo "6. Cleaning IDE/editor files..."
safe_remove ".vscode" "VSCode settings"
safe_remove ".idea" "IntelliJ settings"
find . -type f -name "*.swp" -delete 2>/dev/null
find . -type f -name "*.swo" -delete 2>/dev/null
find . -type f -name "*~" -delete 2>/dev/null
find . -type f -name ".DS_Store" -delete 2>/dev/null

# 7. Remove log files
echo ""
echo "7. Cleaning log files..."
find . -type f -name "*.log" -delete 2>/dev/null
safe_remove "logs" "logs directory"

# 8. Remove temporary files
echo ""
echo "8. Cleaning temporary files..."
safe_remove "tmp" "tmp directory"
safe_remove "temp" "temp directory"
find . -type f -name "*.tmp" -delete 2>/dev/null

echo ""
echo "========================================"
echo "✨ Cleanup complete!"
echo ""

# Show disk space recovered (macOS specific)
if command -v du &> /dev/null; then
    echo "Checking remaining artifacts..."
    REMAINING=$(du -sh . 2>/dev/null | cut -f1)
    echo "Current directory size: $REMAINING"
fi

echo ""
echo "📝 Note: These artifacts are created by:"
echo "   - __pycache__: Python bytecode compilation (automatic)"
echo "   - venv: Virtual environment (should use system Python!)"
echo "   - .pytest_cache: Running pytest tests"
echo "   - data/: Running the indexer (stores FAISS index)"
echo "   - .DS_Store: macOS Finder metadata"
echo ""
echo "All these are already in .gitignore and won't be committed."