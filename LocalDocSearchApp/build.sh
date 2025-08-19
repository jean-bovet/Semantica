#!/bin/bash

echo "=========================================="
echo "LocalDocSearch App Build Script"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "Package.swift" ]; then
    echo -e "${RED}Error: Package.swift not found. Run this script from LocalDocSearchApp directory.${NC}"
    exit 1
fi

echo -e "\n${YELLOW}Step 1: Setting up Python environment${NC}"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install Python dependencies
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install py2app

# Install the same dependencies as the CLI tool
pip install faiss-cpu>=1.7.4
pip install sentence-transformers>=2.2.2
pip install ollama>=0.3.1
pip install langchain>=0.2.11
pip install langchain-community>=0.2.10
pip install PyPDF2>=3.0.1
pip install python-docx>=1.1.0
pip install chardet>=5.2.0
pip install pyyaml>=6.0.1
pip install tqdm>=4.66.4
pip install numpy>=1.26.0

echo -e "\n${YELLOW}Step 2: Copying Python source files${NC}"

# Create python_src directory
mkdir -p LocalDocSearch/python_src

# Copy Python files from local-doc-search
cp ../local-doc-search/src/*.py LocalDocSearch/python_src/
cp ../local-doc-search/config.yaml LocalDocSearch/python_src/

echo "Python files copied successfully"

echo -e "\n${YELLOW}Step 3: Building Python framework with py2app${NC}"

# Run py2app to create Python framework
python setup.py py2app --packages=numpy,faiss,sentence_transformers

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: py2app build failed${NC}"
    exit 1
fi

echo -e "\n${YELLOW}Step 4: Building Swift application${NC}"

# Build the Swift app
swift build -c release

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Swift build failed${NC}"
    exit 1
fi

echo -e "\n${YELLOW}Step 5: Creating app bundle${NC}"

# Create app bundle structure
APP_NAME="LocalDocSearch"
APP_BUNDLE="$APP_NAME.app"
CONTENTS="$APP_BUNDLE/Contents"

rm -rf "$APP_BUNDLE"
mkdir -p "$CONTENTS/MacOS"
mkdir -p "$CONTENTS/Resources"
mkdir -p "$CONTENTS/Frameworks"

# Copy executable
cp .build/release/LocalDocSearch "$CONTENTS/MacOS/"

# Copy Info.plist
cp LocalDocSearch/Info.plist "$CONTENTS/"

# Copy Python framework
if [ -d "LocalDocSearch/Resources/Python.framework" ]; then
    cp -R LocalDocSearch/Resources/Python.framework "$CONTENTS/Frameworks/"
    echo "Python framework bundled"
fi

# Create a basic icon (you should replace this with actual icon)
echo "Creating placeholder icon..."
touch "$CONTENTS/Resources/AppIcon.icns"

echo -e "\n${YELLOW}Step 6: Code signing (optional)${NC}"

# Check if we have a developer certificate
if security find-identity -v -p codesigning | grep -q "Developer ID"; then
    echo "Found Developer ID certificate. Signing app..."
    codesign --deep --force --verify --verbose \
        --sign "Developer ID Application" \
        --options runtime \
        "$APP_BUNDLE"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}App signed successfully${NC}"
    else
        echo -e "${YELLOW}Warning: Code signing failed${NC}"
    fi
else
    echo "No Developer ID certificate found. Skipping code signing."
fi

echo -e "\n${YELLOW}Step 7: Creating DMG installer${NC}"

# Create DMG
DMG_NAME="LocalDocSearch-1.0.0.dmg"
rm -f "$DMG_NAME"

# Create a temporary directory for DMG contents
mkdir -p dmg_contents
cp -R "$APP_BUNDLE" dmg_contents/
ln -s /Applications dmg_contents/Applications

# Create DMG
hdiutil create -volname "LocalDocSearch" \
    -srcfolder dmg_contents \
    -ov -format UDZO \
    "$DMG_NAME"

# Clean up
rm -rf dmg_contents

if [ -f "$DMG_NAME" ]; then
    echo -e "\n${GREEN}=========================================="
    echo "Build completed successfully!"
    echo "=========================================="
    echo -e "${NC}"
    echo "App bundle: $APP_BUNDLE"
    echo "DMG installer: $DMG_NAME"
    echo ""
    echo "To run the app:"
    echo "  open $APP_BUNDLE"
    echo ""
    echo "To install:"
    echo "  1. Open $DMG_NAME"
    echo "  2. Drag LocalDocSearch to Applications"
else
    echo -e "${RED}Error: Failed to create DMG${NC}"
    exit 1
fi

# Deactivate virtual environment
deactivate