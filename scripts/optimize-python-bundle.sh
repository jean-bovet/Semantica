#!/bin/bash
set -e

# Optimize Python bundle by removing unnecessary files and stripping binaries
# This can reduce bundle size by 100-200MB

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ $# -eq 0 ]; then
    echo -e "${RED}Error: No venv directory specified${NC}"
    echo "Usage: $0 <venv_dir>"
    exit 1
fi

VENV_DIR="$1"
SITE_PACKAGES="$VENV_DIR/lib/python*/site-packages"

if [ ! -d "$VENV_DIR" ]; then
    echo -e "${RED}Error: Directory not found: $VENV_DIR${NC}"
    exit 1
fi

echo -e "${GREEN}=== Optimizing Python Bundle ===${NC}"
echo "Location: $VENV_DIR"
echo

# Show initial size
INITIAL_SIZE=$(du -sh "$VENV_DIR" | cut -f1)
echo "Initial size: $INITIAL_SIZE"
echo

# 1. Remove test files
echo -e "${GREEN}1. Removing test files...${NC}"
TEST_COUNT=0
for pattern in "tests" "test" "*_test.py" "test_*.py"; do
    COUNT=$(find $SITE_PACKAGES -name "$pattern" -type d 2>/dev/null | wc -l | tr -d ' ')
    TEST_COUNT=$((TEST_COUNT + COUNT))
    find $SITE_PACKAGES -name "$pattern" -type d -exec rm -rf {} + 2>/dev/null || true
done
find $SITE_PACKAGES -name "*_test.py" -type f -delete 2>/dev/null || true
find $SITE_PACKAGES -name "test_*.py" -type f -delete 2>/dev/null || true
echo "  Removed $TEST_COUNT test directories"

# 2. Remove documentation
echo -e "${GREEN}2. Removing documentation...${NC}"
DOC_COUNT=0
for pattern in "docs" "doc" "examples" "example" "*.md" "*.rst" "*.txt"; do
    if [ "$pattern" = "*.md" ] || [ "$pattern" = "*.rst" ] || [ "$pattern" = "*.txt" ]; then
        # For file patterns, just count and delete files in site-packages root
        COUNT=$(find $SITE_PACKAGES -maxdepth 2 -name "$pattern" -type f 2>/dev/null | wc -l | tr -d ' ')
        find $SITE_PACKAGES -maxdepth 2 -name "$pattern" -type f -delete 2>/dev/null || true
    else
        # For directory patterns
        COUNT=$(find $SITE_PACKAGES -name "$pattern" -type d 2>/dev/null | wc -l | tr -d ' ')
        find $SITE_PACKAGES -name "$pattern" -type d -exec rm -rf {} + 2>/dev/null || true
    fi
    DOC_COUNT=$((DOC_COUNT + COUNT))
done
echo "  Removed $DOC_COUNT documentation files/directories"

# 3. Remove benchmark/profiling code
echo -e "${GREEN}3. Removing benchmarks...${NC}"
BENCH_COUNT=$(find $SITE_PACKAGES -name "benchmark*" -o -name "*_benchmark.py" 2>/dev/null | wc -l | tr -d ' ')
find $SITE_PACKAGES \( -name "benchmark*" -o -name "*_benchmark.py" \) -exec rm -rf {} + 2>/dev/null || true
echo "  Removed $BENCH_COUNT benchmark files"

# 4. Remove __pycache__ and .pyc files (will be regenerated)
echo -e "${GREEN}4. Removing Python cache files...${NC}"
CACHE_COUNT=$(find $SITE_PACKAGES -type d -name "__pycache__" 2>/dev/null | wc -l | tr -d ' ')
find $SITE_PACKAGES -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find $SITE_PACKAGES -name "*.pyc" -delete 2>/dev/null || true
find $SITE_PACKAGES -name "*.pyo" -delete 2>/dev/null || true
echo "  Removed $CACHE_COUNT __pycache__ directories"

# 5. Strip debug symbols from native libraries
echo -e "${GREEN}5. Stripping debug symbols from native libraries...${NC}"
if command -v strip &> /dev/null; then
    SO_COUNT=$(find $SITE_PACKAGES -name "*.so" -type f 2>/dev/null | wc -l | tr -d ' ')
    find $SITE_PACKAGES -name "*.so" -type f -exec strip -x {} \; 2>/dev/null || true
    DYLIB_COUNT=$(find $SITE_PACKAGES -name "*.dylib" -type f 2>/dev/null | wc -l | tr -d ' ')
    find $SITE_PACKAGES -name "*.dylib" -type f -exec strip -x {} \; 2>/dev/null || true
    echo "  Stripped $SO_COUNT .so files and $DYLIB_COUNT .dylib files"
else
    echo -e "${YELLOW}  Warning: 'strip' command not found, skipping${NC}"
fi

# 6. Remove specific large unnecessary packages
echo -e "${GREEN}6. Removing unnecessary package files...${NC}"

# Remove numpy tests (can be large)
if [ -d $SITE_PACKAGES/numpy/tests ]; then
    rm -rf $SITE_PACKAGES/numpy/tests
    echo "  Removed numpy tests"
fi

# Remove scipy tests
if [ -d $SITE_PACKAGES/scipy/tests ]; then
    rm -rf $SITE_PACKAGES/scipy/tests 2>/dev/null || true
    echo "  Removed scipy tests"
fi

# Remove PIL/Pillow tests
find $SITE_PACKAGES -path "*/PIL/Tests" -type d -exec rm -rf {} + 2>/dev/null || true

# Note: We do NOT remove CUDA/ROCm files on macOS because they don't exist
# PyTorch for macOS doesn't include CUDA support

# 7. Compress with Python's -OO mode (create optimized .pyc files)
echo -e "${GREEN}7. Creating optimized bytecode...${NC}"
"$VENV_DIR/bin/python3" -OO -m compileall -q "$SITE_PACKAGES" 2>/dev/null || {
    echo -e "${YELLOW}  Warning: Bytecode optimization failed, continuing...${NC}"
}

# Show final size and savings
echo
FINAL_SIZE=$(du -sh "$VENV_DIR" | cut -f1)
echo -e "${GREEN}Optimization complete!${NC}"
echo "Initial size: $INITIAL_SIZE"
echo "Final size: $FINAL_SIZE"
echo

# Calculate savings (approximate, since du output includes unit)
echo -e "${GREEN}Summary:${NC}"
echo "  - Removed test files and benchmarks"
echo "  - Removed documentation"
echo "  - Stripped debug symbols from native libraries"
echo "  - Removed Python cache files"
echo "  - Created optimized bytecode"
echo

echo -e "${YELLOW}Note: On macOS, PyTorch already excludes CUDA support${NC}"
echo -e "${YELLOW}MPS (Apple Silicon GPU) support is preserved${NC}"
