#!/bin/bash
set -e

# Bundle Poppler utilities for Semantica
# This bundles pdftoppm, pdfinfo, and required dylibs for OCR support

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Semantica Poppler Bundler ===${NC}"
echo

# Detect platform
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    PLATFORM="darwin-arm64"
    HOMEBREW_PREFIX="/opt/homebrew"
elif [ "$ARCH" = "x86_64" ]; then
    PLATFORM="darwin-x64"
    HOMEBREW_PREFIX="/usr/local"
else
    echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"
    exit 1
fi

echo -e "${GREEN}Platform detected: $PLATFORM${NC}"
echo "Homebrew prefix: $HOMEBREW_PREFIX"
echo

# Paths
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOURCES_DIR="$PROJECT_ROOT/resources/poppler/$PLATFORM"
POPPLER_PREFIX="$HOMEBREW_PREFIX/opt/poppler"

echo "Project root: $PROJECT_ROOT"
echo "Resources dir: $RESOURCES_DIR"
echo "Poppler prefix: $POPPLER_PREFIX"
echo

# Check if Poppler is installed via Homebrew
if [ ! -d "$POPPLER_PREFIX" ]; then
    echo -e "${RED}Error: Poppler not found at $POPPLER_PREFIX${NC}"
    echo
    echo "Please install Poppler via Homebrew:"
    echo "  brew install poppler"
    exit 1
fi

# Check if dylibbundler is installed
if ! command -v dylibbundler &> /dev/null; then
    echo -e "${RED}Error: dylibbundler not found${NC}"
    echo
    echo "Please install dylibbundler via Homebrew:"
    echo "  brew install dylibbundler"
    exit 1
fi

# Check for required binaries
PDFTOPPM="$POPPLER_PREFIX/bin/pdftoppm"
PDFINFO="$POPPLER_PREFIX/bin/pdfinfo"

if [ ! -f "$PDFTOPPM" ]; then
    echo -e "${RED}Error: pdftoppm not found at $PDFTOPPM${NC}"
    exit 1
fi

if [ ! -f "$PDFINFO" ]; then
    echo -e "${RED}Error: pdfinfo not found at $PDFINFO${NC}"
    exit 1
fi

echo -e "${GREEN}Found required binaries:${NC}"
echo "  pdftoppm: $PDFTOPPM"
echo "  pdfinfo: $PDFINFO"
echo

# Create resources directory
mkdir -p "$RESOURCES_DIR/lib"

# Remove existing binaries if present
echo -e "${GREEN}Cleaning existing bundle...${NC}"
rm -f "$RESOURCES_DIR/pdftoppm"
rm -f "$RESOURCES_DIR/pdfinfo"
rm -rf "$RESOURCES_DIR/lib"/*

# Copy binaries
echo -e "${GREEN}Copying binaries...${NC}"
cp "$PDFTOPPM" "$RESOURCES_DIR/"
cp "$PDFINFO" "$RESOURCES_DIR/"
echo "  Copied pdftoppm and pdfinfo"

# Use dylibbundler to copy and fix library dependencies
echo
echo -e "${GREEN}Bundling dependencies with dylibbundler...${NC}"
echo -e "${YELLOW}This may take a minute...${NC}"
echo

# Bundle dependencies for pdftoppm
dylibbundler -of -b \
    -x "$RESOURCES_DIR/pdftoppm" \
    -d "$RESOURCES_DIR/lib" \
    -p @executable_path/lib 2>&1 | grep -v "already present" || true

# Bundle dependencies for pdfinfo
dylibbundler -of -b \
    -x "$RESOURCES_DIR/pdfinfo" \
    -d "$RESOURCES_DIR/lib" \
    -p @executable_path/lib 2>&1 | grep -v "already present" || true

echo
echo -e "${GREEN}Dependencies bundled successfully${NC}"

# Add GPL license
echo
echo -e "${GREEN}Adding GPL license...${NC}"
cat > "$RESOURCES_DIR/LICENSE" << 'EOF'
Poppler PDF Rendering Library
==============================

Poppler is licensed under the GPL v2 or GPL v3.

This distribution includes the following Poppler utilities:
- pdftoppm: PDF to image converter
- pdfinfo: PDF metadata extractor

Source code is available at:
https://poppler.freedesktop.org/

Note: Semantica uses these utilities as separate executables (subprocess
execution), not as linked libraries. This should be compatible with
Semantica's MIT license, but please consult legal counsel for confirmation.

For the full GPL license text, see:
https://www.gnu.org/licenses/gpl-2.0.html (GPL v2)
https://www.gnu.org/licenses/gpl-3.0.html (GPL v3)
EOF

echo "  Created LICENSE file"

# Test bundled binaries
echo
echo -e "${GREEN}Testing bundled binaries...${NC}"

# Set library path for testing
export DYLD_LIBRARY_PATH="$RESOURCES_DIR/lib:$DYLD_LIBRARY_PATH"

# Test pdftoppm
if "$RESOURCES_DIR/pdftoppm" -v &> /dev/null; then
    VERSION=$("$RESOURCES_DIR/pdftoppm" -v 2>&1 | head -n 1 || true)
    echo -e "  ${GREEN}✓${NC} pdftoppm works: $VERSION"
else
    echo -e "  ${RED}✗${NC} pdftoppm failed"
    echo -e "${RED}Error: Bundled pdftoppm is not working${NC}"
    exit 1
fi

# Test pdfinfo
if "$RESOURCES_DIR/pdfinfo" -v &> /dev/null; then
    VERSION=$("$RESOURCES_DIR/pdfinfo" -v 2>&1 | head -n 1 || true)
    echo -e "  ${GREEN}✓${NC} pdfinfo works: $VERSION"
else
    echo -e "  ${RED}✗${NC} pdfinfo failed"
    echo -e "${RED}Error: Bundled pdfinfo is not working${NC}"
    exit 1
fi

# Show bundle size
echo
BUNDLE_SIZE=$(du -sh "$RESOURCES_DIR" | cut -f1)
LIB_COUNT=$(ls -1 "$RESOURCES_DIR/lib" | wc -l | tr -d ' ')
echo -e "${GREEN}Bundle created successfully!${NC}"
echo "Location: $RESOURCES_DIR"
echo "Size: $BUNDLE_SIZE"
echo "Libraries bundled: $LIB_COUNT"
echo

# List bundled libraries
echo -e "${YELLOW}Bundled libraries:${NC}"
ls -lh "$RESOURCES_DIR/lib" | tail -n +2 | awk '{printf "  %s (%s)\n", $9, $5}'
echo

# Show next steps
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Update package.json with extraResources configuration"
echo "2. Modify PythonSidecarService.ts to add Poppler to PATH"
echo "3. Set DYLD_LIBRARY_PATH in getPythonEnv()"
echo "4. Build app: npm run package"
echo

echo -e "${GREEN}Done!${NC}"
