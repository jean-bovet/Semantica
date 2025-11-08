#!/bin/bash
# Check if required bundles exist before running app
# This prevents cryptic errors and guides users to run bundling scripts

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Detect platform
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    PLATFORM="darwin-arm64"
elif [ "$ARCH" = "x86_64" ]; then
    PLATFORM="darwin-x64"
else
    echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"
    exit 1
fi

# Paths
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BUNDLE="$PROJECT_ROOT/resources/python/$PLATFORM/venv/bin/python3"

MISSING=false

# Check Python bundle
if [ ! -f "$PYTHON_BUNDLE" ]; then
    echo -e "${RED}❌ Bundled Python not found${NC}"
    echo "   Expected: $PYTHON_BUNDLE"
    echo "   Run: ${YELLOW}./scripts/bundle-python.sh${NC}"
    echo
    MISSING=true
else
    echo -e "${GREEN}✅ Bundled Python found${NC}"
fi

# Note: Poppler check removed - OCR is now handled natively in Node.js

# Exit with error if anything missing
if [ "$MISSING" = true ]; then
    echo -e "${YELLOW}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║       Bundled dependencies required before running app        ║${NC}"
    echo -e "${YELLOW}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo
    echo "Quick setup:"
    echo -e "  ${GREEN}npm run bundle${NC}   # Bundle Python dependencies (~5-10 minutes)"
    echo
    echo "Or run manually:"
    echo -e "  ${GREEN}./scripts/bundle-python.sh${NC}"
    echo
    echo "See ${YELLOW}docs/guides/bundling-guide.md${NC} for details."
    echo
    exit 1
fi

echo
echo -e "${GREEN}✅ Python bundle present - ready to run!${NC}"
exit 0
