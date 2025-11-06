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
POPPLER_BUNDLE="$PROJECT_ROOT/resources/poppler/$PLATFORM/pdftoppm"

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

# Check Poppler bundle
if [ ! -f "$POPPLER_BUNDLE" ]; then
    echo -e "${RED}❌ Bundled Poppler not found${NC}"
    echo "   Expected: $POPPLER_BUNDLE"
    echo "   Run: ${YELLOW}./scripts/bundle-poppler.sh${NC}"
    echo
    MISSING=true
else
    echo -e "${GREEN}✅ Bundled Poppler found${NC}"
fi

# Exit with error if anything missing
if [ "$MISSING" = true ]; then
    echo -e "${YELLOW}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║       Bundled dependencies required before running app        ║${NC}"
    echo -e "${YELLOW}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo
    echo "Quick setup:"
    echo -e "  ${GREEN}npm run bundle${NC}   # Runs both bundling scripts"
    echo
    echo "Or run individually:"
    echo -e "  ${GREEN}./scripts/bundle-python.sh${NC}   # ~5-10 minutes"
    echo -e "  ${GREEN}./scripts/bundle-poppler.sh${NC}  # <1 minute"
    echo
    echo "See ${YELLOW}docs/guides/bundling-guide.md${NC} for details."
    echo
    exit 1
fi

echo
echo -e "${GREEN}✅ All bundles present - ready to run!${NC}"
exit 0
