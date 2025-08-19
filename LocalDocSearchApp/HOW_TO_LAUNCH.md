# How to Launch LocalDocSearch

## Current Status

1. **Leftover files cleaned** - Removed malformed pip install files (=6.0.1, etc.)
2. **Simple build working** - The `build_simple.sh` creates a basic app bundle

## Quick Launch Options

### Option 1: Use the Simplified App (Already Built)
```bash
# The app was already built with build_simple.sh
open LocalDocSearch.app
```

This opens a Swift window demonstrating the app structure. It shows instructions for using the full functionality.

### Option 2: Run the Python CLI Version
```bash
cd ../local-doc-search
python cli.py interactive
```

This provides the full search functionality in your terminal.

### Option 3: Use Xcode (For Full SwiftUI Development)

1. Create an Xcode project:
```bash
# Generate Xcode project
swift package generate-xcodeproj
```

2. Open in Xcode:
```bash
open LocalDocSearch.xcodeproj
```

3. In Xcode:
   - Select "LocalDocSearch" scheme
   - Click Run (⌘R)
   - The SwiftUI app will launch

Note: The full SwiftUI app has some compilation issues due to:
- PythonKit integration complexities
- Swift/Python bridge requirements
- macOS version compatibility (some features require macOS 14+)

## What Each Component Does

- **LocalDocSearch.app** (from build_simple.sh): Basic demo showing app structure
- **CLI version** (../local-doc-search): Fully functional search engine
- **SwiftUI version** (needs more work): Native Mac interface with Python backend

## Recommended Next Steps

For immediate use:
1. Use the CLI version for actual document searching
2. The simplified app demonstrates the structure

For development:
1. Fix remaining SwiftUI compilation issues
2. Or use PyInstaller approach for self-contained distribution
3. Or implement client-server architecture (Python server + Swift client)