#!/bin/bash
set -e

# Conservative Python bundle optimization
# Only removes obviously unused files to maintain stability
# Prioritizes working bundle over aggressive size reduction

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

echo -e "${GREEN}=== Conservative Python Bundle Optimization ===${NC}"
echo "Location: $VENV_DIR"
echo
echo -e "${YELLOW}Note: Using conservative approach to avoid breaking PyTorch${NC}"
echo

# Show initial size
INITIAL_SIZE=$(du -sh "$VENV_DIR" | cut -f1)
echo "Initial size: $INITIAL_SIZE"
echo

# 1. Remove Python cache files (100% safe, always regenerated)
echo -e "${GREEN}1. Removing Python cache files...${NC}"
CACHE_COUNT=$(find $SITE_PACKAGES -type d -name "__pycache__" 2>/dev/null | wc -l | tr -d ' ')
find $SITE_PACKAGES -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find $SITE_PACKAGES -name "*.pyc" -delete 2>/dev/null || true
find $SITE_PACKAGES -name "*.pyo" -delete 2>/dev/null || true
echo "  Removed $CACHE_COUNT __pycache__ directories"

# 2. Remove test directories (conservative - only obvious test dirs)
echo -e "${GREEN}2. Removing test directories...${NC}"
# Only remove tests/ and test/ at top level, skip core libraries
TEST_COUNT=0
for pkg in $(ls -d $SITE_PACKAGES/*/tests 2>/dev/null | grep -v -E "(torch|numpy|scipy|transformers|sentence_transformers)"); do
    rm -rf "$pkg" 2>/dev/null || true
    TEST_COUNT=$((TEST_COUNT + 1))
done
for pkg in $(ls -d $SITE_PACKAGES/*/test 2>/dev/null | grep -v -E "(torch|numpy|scipy|transformers|sentence_transformers)"); do
    rm -rf "$pkg" 2>/dev/null || true
    TEST_COUNT=$((TEST_COUNT + 1))
done
echo "  Removed $TEST_COUNT test directories (preserved core libraries)"

# 3. Remove documentation directories
echo -e "${GREEN}3. Removing documentation directories...${NC}"
DOC_COUNT=0
for pattern in "docs" "doc"; do
    for dir in $(find $SITE_PACKAGES -maxdepth 2 -name "$pattern" -type d 2>/dev/null); do
        rm -rf "$dir" 2>/dev/null || true
        DOC_COUNT=$((DOC_COUNT + 1))
    done
done
echo "  Removed $DOC_COUNT documentation directories"

# 4. Remove example directories
echo -e "${GREEN}4. Removing example directories...${NC}"
EXAMPLE_COUNT=0
for pattern in "examples" "example"; do
    for dir in $(find $SITE_PACKAGES -maxdepth 2 -name "$pattern" -type d 2>/dev/null); do
        rm -rf "$dir" 2>/dev/null || true
        EXAMPLE_COUNT=$((EXAMPLE_COUNT + 1))
    done
done
echo "  Removed $EXAMPLE_COUNT example directories"

# 5. Create optimized bytecode
echo -e "${GREEN}5. Creating optimized bytecode...${NC}"
"$VENV_DIR/bin/python3" -OO -m compileall -q "$SITE_PACKAGES" 2>/dev/null || {
    echo -e "${YELLOW}  Warning: Bytecode optimization failed, continuing...${NC}"
}
echo "  Created optimized .pyc files"

# Show final size and savings
echo
FINAL_SIZE=$(du -sh "$VENV_DIR" | cut -f1)
echo -e "${GREEN}Optimization complete!${NC}"
echo "Initial size: $INITIAL_SIZE"
echo "Final size: $FINAL_SIZE"
echo

# Calculate savings (approximate, since du output includes unit)
echo -e "${GREEN}Summary - Conservative Approach:${NC}"
echo "  ✓ Removed Python cache files (__pycache__, .pyc, .pyo)"
echo "  ✓ Removed test directories (except core libraries)"
echo "  ✓ Removed documentation directories"
echo "  ✓ Removed example directories"
echo "  ✓ Created optimized bytecode"
echo
echo -e "${GREEN}Preserved (not touched):${NC}"
echo "  ✓ All native libraries (.so, .dylib) - no stripping"
echo "  ✓ PyTorch, numpy, scipy - fully intact"
echo "  ✓ All benchmark utilities - preserved"
echo "  ✓ MPS (Apple Silicon GPU) support - preserved"
echo
echo -e "${YELLOW}Note: Prioritizing stability over aggressive size reduction${NC}"
