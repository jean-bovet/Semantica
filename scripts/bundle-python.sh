#!/bin/bash
set -e

# Bundle Python runtime and dependencies for Semantica
# This creates a self-contained Python environment for the app

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Semantica Python Bundler ===${NC}"
echo

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

echo -e "${GREEN}Platform detected: $PLATFORM${NC}"

# Paths
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOURCES_DIR="$PROJECT_ROOT/resources/python/$PLATFORM"
VENV_DIR="$RESOURCES_DIR/venv"
REQUIREMENTS_FILE="$PROJECT_ROOT/embedding_sidecar/requirements.txt"

echo "Project root: $PROJECT_ROOT"
echo "Resources dir: $RESOURCES_DIR"
echo

# Check if requirements file exists
if [ ! -f "$REQUIREMENTS_FILE" ]; then
    echo -e "${RED}Error: Requirements file not found: $REQUIREMENTS_FILE${NC}"
    exit 1
fi

# Check for Python 3.11
PYTHON_CMD=""
for cmd in python3.11 python3 python; do
    if command -v $cmd &> /dev/null; then
        VERSION=$($cmd --version 2>&1 | awk '{print $2}')
        MAJOR=$(echo $VERSION | cut -d. -f1)
        MINOR=$(echo $VERSION | cut -d. -f2)
        if [ "$MAJOR" = "3" ] && [ "$MINOR" -ge "9" ]; then
            PYTHON_CMD=$cmd
            echo -e "${GREEN}Found Python: $cmd ($VERSION)${NC}"
            break
        fi
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    echo -e "${RED}Error: Python 3.9+ not found${NC}"
    echo "Please install Python 3.11 from https://www.python.org/downloads/"
    exit 1
fi

# Create resources directory
mkdir -p "$RESOURCES_DIR"

# Remove existing venv if present
if [ -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}Removing existing virtual environment...${NC}"
    rm -rf "$VENV_DIR"
fi

# Create virtual environment
echo -e "${GREEN}Creating virtual environment...${NC}"
$PYTHON_CMD -m venv "$VENV_DIR"

if [ ! -f "$VENV_DIR/bin/python3" ]; then
    echo -e "${RED}Error: Failed to create virtual environment${NC}"
    exit 1
fi

echo -e "${GREEN}Virtual environment created successfully${NC}"
echo

# Upgrade pip
echo -e "${GREEN}Upgrading pip...${NC}"
"$VENV_DIR/bin/python3" -m pip install --upgrade pip > /dev/null

# Install dependencies
echo -e "${GREEN}Installing dependencies from requirements.txt...${NC}"
echo -e "${YELLOW}This will take 3-10 minutes and download ~2.2GB...${NC}"
echo

"$VENV_DIR/bin/pip" install -r "$REQUIREMENTS_FILE"

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to install dependencies${NC}"
    exit 1
fi

echo
echo -e "${GREEN}Dependencies installed successfully${NC}"
echo

# Run optimization script
OPTIMIZE_SCRIPT="$PROJECT_ROOT/scripts/optimize-python-bundle.sh"
if [ -f "$OPTIMIZE_SCRIPT" ]; then
    echo -e "${GREEN}Running optimization script...${NC}"
    bash "$OPTIMIZE_SCRIPT" "$VENV_DIR"
else
    echo -e "${YELLOW}Warning: Optimization script not found: $OPTIMIZE_SCRIPT${NC}"
    echo -e "${YELLOW}Bundle will not be optimized (larger size)${NC}"
fi

# Verify installation
echo
echo -e "${GREEN}Verifying installation...${NC}"

# Test imports
"$VENV_DIR/bin/python3" -c "import torch; print(f'PyTorch: {torch.__version__}')" || {
    echo -e "${RED}Error: PyTorch import failed${NC}"
    exit 1
}

"$VENV_DIR/bin/python3" -c "import transformers; print(f'Transformers: {transformers.__version__}')" || {
    echo -e "${RED}Error: Transformers import failed${NC}"
    exit 1
}

"$VENV_DIR/bin/python3" -c "import sentence_transformers; print(f'Sentence Transformers: {sentence_transformers.__version__}')" || {
    echo -e "${RED}Error: Sentence Transformers import failed${NC}"
    exit 1
}

# Check device support
echo
echo -e "${GREEN}Checking device support...${NC}"
"$VENV_DIR/bin/python3" << 'EOF'
import torch
print(f"MPS available: {torch.backends.mps.is_available()}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.backends.mps.is_available():
    print("✓ Apple Silicon GPU (MPS) support enabled")
else:
    print("  CPU-only mode (Intel Mac or MPS unavailable)")
EOF

# Show bundle size
echo
BUNDLE_SIZE=$(du -sh "$VENV_DIR" | cut -f1)
echo -e "${GREEN}Bundle created successfully!${NC}"
echo "Location: $VENV_DIR"
echo "Size: $BUNDLE_SIZE"
echo

# Show next steps
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Run './scripts/bundle-poppler.sh' to bundle Poppler utilities"
echo "2. Update package.json with extraResources configuration"
echo "3. Modify PythonSidecarService.ts to use bundled Python"
echo "4. Build app: npm run package"
echo

echo -e "${GREEN}Done!${NC}"
