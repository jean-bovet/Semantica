#!/bin/bash

echo "=========================================="
echo "LocalDocSearch App Build Script (Simplified)"
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

echo -e "\n${YELLOW}Step 1: Copying Python source files${NC}"

# Run the Python setup script
python3 setup.py

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to copy Python sources${NC}"
    exit 1
fi

echo -e "\n${YELLOW}Step 2: Creating app bundle structure${NC}"

# Create app bundle structure
APP_NAME="LocalDocSearch"
APP_BUNDLE="$APP_NAME.app"
CONTENTS="$APP_BUNDLE/Contents"

rm -rf "$APP_BUNDLE"
mkdir -p "$CONTENTS/MacOS"
mkdir -p "$CONTENTS/Resources"
mkdir -p "$CONTENTS/Frameworks"

echo "App bundle structure created"

echo -e "\n${YELLOW}Step 3: Creating a simple launcher script${NC}"

# Create a launcher script that uses system Python
cat > "$CONTENTS/MacOS/LocalDocSearch" << 'EOF'
#!/bin/bash

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_RESOURCES="$DIR/../Resources"

# Set Python path to include our modules
export PYTHONPATH="$APP_RESOURCES/python_src:$PYTHONPATH"

# Check if Python 3 is available
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    osascript -e 'display alert "Python Not Found" message "This application requires Python 3 to be installed. Please install Python from python.org" as critical'
    exit 1
fi

# Launch the Python search engine (in demo mode for now)
$PYTHON_CMD -c "
import sys
import os
sys.path.insert(0, '$APP_RESOURCES/python_src')

# Simple demo - in real app, this would launch the GUI
print('LocalDocSearch Engine')
print('Python:', sys.version)
print('Modules path:', '$APP_RESOURCES/python_src')

try:
    from search import DocumentSearchEngine
    print('✓ Search engine module loaded successfully')
    
    # Initialize the engine
    engine = DocumentSearchEngine()
    print('✓ Search engine initialized')
    
    stats = engine.indexer.get_statistics()
    print(f'Index contains {stats[\"total_documents\"]} documents')
    
except ImportError as e:
    print(f'Error loading search engine: {e}')
    print('Please ensure all dependencies are installed:')
    print('  pip install faiss-cpu sentence-transformers PyPDF2 python-docx')
except Exception as e:
    print(f'Error: {e}')

input('Press Enter to exit...')
"
EOF

chmod +x "$CONTENTS/MacOS/LocalDocSearch"

echo -e "\n${YELLOW}Step 4: Copying resources${NC}"

# Copy Python source files to Resources
cp -r LocalDocSearch/python_src "$CONTENTS/Resources/"

# Copy Info.plist
cp LocalDocSearch/Info.plist "$CONTENTS/"

# Create a basic icon file (placeholder)
touch "$CONTENTS/Resources/AppIcon.icns"

echo "Resources copied"

echo -e "\n${YELLOW}Step 5: Creating a native Swift launcher (optional)${NC}"

# Create a simple Swift file for a native launcher
cat > LocalDocSearch/SimpleLauncher.swift << 'EOF'
import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Create window
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        
        window.title = "LocalDocSearch"
        window.center()
        
        // Create a simple message
        let textView = NSTextView(frame: window.contentView!.bounds)
        textView.string = """
        LocalDocSearch - Development Version
        
        This is a simplified version that demonstrates the app structure.
        
        To use the full search functionality:
        1. Install Python dependencies:
           pip install faiss-cpu sentence-transformers PyPDF2 python-docx
        
        2. Run the Python CLI version:
           cd ../local-doc-search
           python cli.py interactive
        
        The full SwiftUI app with Python integration requires:
        - Proper Python embedding (without py2app issues)
        - Or using a Python server with Swift client
        """
        textView.isEditable = false
        textView.autoresizingMask = [.width, .height]
        
        window.contentView = textView
        window.makeKeyAndOrderFront(nil)
    }
    
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}
EOF

echo "Swift launcher created"

echo -e "\n${YELLOW}Step 6: Compiling Swift launcher${NC}"

# Try to compile the Swift launcher
if command -v swiftc &> /dev/null; then
    swiftc -parse-as-library LocalDocSearch/SimpleLauncher.swift -o "$CONTENTS/MacOS/LocalDocSearchSwift"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Swift launcher compiled successfully${NC}"
        # Use Swift launcher as main executable
        mv "$CONTENTS/MacOS/LocalDocSearch" "$CONTENTS/MacOS/LocalDocSearch.sh"
        mv "$CONTENTS/MacOS/LocalDocSearchSwift" "$CONTENTS/MacOS/LocalDocSearch"
    else
        echo -e "${YELLOW}Swift compilation failed, using shell launcher${NC}"
    fi
else
    echo -e "${YELLOW}Swift compiler not found, using shell launcher${NC}"
fi

echo -e "\n${YELLOW}Step 7: Setting permissions${NC}"

# Make the app bundle executable
chmod -R 755 "$APP_BUNDLE"

echo -e "\n${GREEN}=========================================="
echo "Build completed!"
echo "=========================================="
echo -e "${NC}"
echo "App bundle created: $APP_BUNDLE"
echo ""
echo "To test the app:"
echo "  open $APP_BUNDLE"
echo ""
echo -e "${YELLOW}Note: This is a simplified version.${NC}"
echo "For full functionality, users need Python 3 and the required packages installed."
echo ""
echo "To create a fully self-contained app, consider:"
echo "1. Using PyInstaller instead of py2app"
echo "2. Creating a client-server architecture"
echo "3. Using a different Python version (3.11 or lower) that works with py2app"
echo ""