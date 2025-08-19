#!/bin/bash

echo "=========================================="
echo "LocalDocSearch PyInstaller Build Script"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "\n${YELLOW}Step 1: Setting up Python environment${NC}"

# Create virtual environment if it doesn't exist
if [ ! -d "venv_pyinstaller" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv_pyinstaller
fi

# Activate virtual environment
source venv_pyinstaller/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install --upgrade pip
pip install pyinstaller>=6.0.0

# Install the search engine dependencies
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
pip install click>=8.1.7
pip install rich>=13.7.1

echo -e "\n${YELLOW}Step 2: Creating PyInstaller entry point${NC}"

# Create a main entry point for PyInstaller
cat > main_app.py << 'EOF'
#!/usr/bin/env python3
"""
Main entry point for the LocalDocSearch PyInstaller bundle
"""

import sys
import os
import json
from pathlib import Path

# Add the src directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from search import DocumentSearchEngine
from document_processor import DocumentProcessor
from indexer import DocumentIndexer
from embeddings import EmbeddingManager

def handle_command(command_json):
    """Handle commands from the Swift app"""
    try:
        command = json.loads(command_json)
        action = command.get('action')
        
        # Initialize the search engine
        engine = DocumentSearchEngine()
        
        if action == 'index':
            folder_path = command.get('folder')
            if folder_path:
                documents = engine.processor.process_folder(folder_path)
                engine.index_documents(documents)
                return json.dumps({
                    'success': True,
                    'message': f'Indexed {len(documents)} documents'
                })
        
        elif action == 'search':
            query = command.get('query')
            limit = command.get('limit', 10)
            if query:
                results = engine.search(query, top_k=limit)
                return json.dumps({
                    'success': True,
                    'results': results
                })
        
        elif action == 'stats':
            stats = engine.indexer.get_statistics()
            return json.dumps({
                'success': True,
                'stats': stats
            })
        
        elif action == 'clear':
            engine.indexer.clear_index()
            return json.dumps({
                'success': True,
                'message': 'Index cleared'
            })
        
        else:
            return json.dumps({
                'success': False,
                'error': f'Unknown action: {action}'
            })
            
    except Exception as e:
        return json.dumps({
            'success': False,
            'error': str(e)
        })

def main():
    """Main entry point"""
    if len(sys.argv) > 1:
        # Handle command from Swift app
        command = sys.argv[1]
        result = handle_command(command)
        print(result)
    else:
        # Interactive mode for testing
        print("LocalDocSearch Engine (PyInstaller Bundle)")
        print("Version: 1.0.0")
        print("Python:", sys.version)
        print("\nReady for commands...")
        
        while True:
            try:
                command = input("\nEnter command JSON (or 'quit' to exit): ")
                if command.lower() == 'quit':
                    break
                result = handle_command(command)
                print("Result:", result)
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"Error: {e}")

if __name__ == "__main__":
    main()
EOF

echo "Entry point created"

echo -e "\n${YELLOW}Step 3: Copying source files${NC}"

# Copy source files
mkdir -p src
cp ../local-doc-search/src/*.py src/
cp ../local-doc-search/config.yaml src/

echo "Source files copied"

echo -e "\n${YELLOW}Step 4: Creating PyInstaller spec file${NC}"

# Create PyInstaller spec file
cat > LocalDocSearch.spec << 'EOF'
# -*- mode: python ; coding: utf-8 -*-

import sys
import os
from PyInstaller.utils.hooks import collect_data_files, collect_all

# Collect all data files from sentence_transformers
datas = []
hiddenimports = []

# Collect sentence_transformers
transformer_datas, transformer_binaries, transformer_hiddenimports = collect_all('sentence_transformers')
datas += transformer_datas
hiddenimports += transformer_hiddenimports

# Collect other necessary packages
for package in ['torch', 'transformers', 'faiss', 'numpy', 'scipy']:
    try:
        pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(package)
        datas += pkg_datas
        hiddenimports += pkg_hiddenimports
    except:
        pass

# Add config file
datas += [('src/config.yaml', 'src')]

a = Analysis(
    ['main_app.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports + [
        'sklearn.utils._typedefs',
        'sklearn.neighbors._partition_nodes',
        'scipy.special._ufuncs',
        'scipy._lib.messagestream',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='LocalDocSearchEngine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='LocalDocSearchEngine',
)
EOF

echo "Spec file created"

echo -e "\n${YELLOW}Step 5: Building with PyInstaller${NC}"

# Build with PyInstaller
pyinstaller LocalDocSearch.spec --clean --noconfirm

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: PyInstaller build failed${NC}"
    echo "Trying simpler build..."
    pyinstaller main_app.py \
        --name LocalDocSearchEngine \
        --add-data "src/config.yaml:src" \
        --collect-all sentence_transformers \
        --collect-all torch \
        --collect-all transformers \
        --collect-all faiss \
        --noconfirm
fi

echo -e "\n${YELLOW}Step 6: Creating macOS app bundle${NC}"

# Create app bundle
APP_NAME="LocalDocSearch"
APP_BUNDLE="$APP_NAME.app"
CONTENTS="$APP_BUNDLE/Contents"

rm -rf "$APP_BUNDLE"
mkdir -p "$CONTENTS/MacOS"
mkdir -p "$CONTENTS/Resources"
mkdir -p "$CONTENTS/Frameworks"

# Copy PyInstaller output
if [ -d "dist/LocalDocSearchEngine" ]; then
    cp -R dist/LocalDocSearchEngine/* "$CONTENTS/Resources/"
    echo "PyInstaller bundle copied"
else
    echo -e "${RED}Warning: PyInstaller output not found${NC}"
fi

# Create launcher script
cat > "$CONTENTS/MacOS/LocalDocSearch" << 'EOF'
#!/bin/bash

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_RESOURCES="$DIR/../Resources"

# Launch the PyInstaller bundle
if [ -f "$APP_RESOURCES/LocalDocSearchEngine" ]; then
    "$APP_RESOURCES/LocalDocSearchEngine" "$@"
else
    osascript -e 'display alert "Engine Not Found" message "The search engine could not be found. Please rebuild the application." as critical'
    exit 1
fi
EOF

chmod +x "$CONTENTS/MacOS/LocalDocSearch"

# Copy Info.plist
cp LocalDocSearch/Info.plist "$CONTENTS/"

echo -e "\n${GREEN}=========================================="
echo "PyInstaller build completed!"
echo "=========================================="
echo -e "${NC}"
echo "App bundle: $APP_BUNDLE"
echo ""
echo "The app now includes a fully self-contained Python environment."
echo "Users don't need Python installed on their system."
echo ""
echo "To test: open $APP_BUNDLE"

# Deactivate virtual environment
deactivate