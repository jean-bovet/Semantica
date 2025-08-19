# SwiftUI with Python Backend via PyObjC - Architecture Guide

## Overview

This approach creates a **native macOS app** with a beautiful SwiftUI interface while leveraging your existing Python search engine code. It's the best of both worlds: native UI performance and Python's ML capabilities.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   macOS Application                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────┐    ┌────────────────────┐    │
│  │                      │    │                    │    │
│  │    SwiftUI Views     │───▶│   PyObjC Bridge    │    │
│  │   (Native macOS)     │    │  (Objective-C)     │    │
│  │                      │◀───│                    │    │
│  └──────────────────────┘    └────────────────────┘    │
│              │                         │                │
│              │                         ▼                │
│              │                ┌────────────────────┐    │
│              │                │                    │    │
│              └───────────────▶│  Python Backend    │    │
│                               │  (Search Engine)   │    │
│                               │                    │    │
│                               └────────────────────┘    │
│                                        │                │
│                                        ▼                │
│                               ┌────────────────────┐    │
│                               │   FAISS + Ollama   │    │
│                               │   (Local Models)   │    │
│                               └────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## How It Works

### 1. PyObjC Bridge
PyObjC is Apple's official bridge between Python and Objective-C/Swift:
- Allows Python objects to be used from Swift
- Enables Swift to call Python functions
- Maintains Python runtime within the app bundle
- Full access to macOS frameworks from Python

### 2. Communication Flow

```swift
// Swift UI View
struct SearchView: View {
    @State private var searchQuery = ""
    @State private var results: [SearchResult] = []
    
    var body: some View {
        VStack {
            TextField("Search documents...", text: $searchQuery)
                .onSubmit {
                    // Call Python backend
                    results = PythonBridge.shared.search(query: searchQuery)
                }
            
            List(results) { result in
                DocumentRow(document: result)
            }
        }
    }
}
```

```python
# Python Backend (wrapped with PyObjC)
from Foundation import NSObject
from objc import python_method
import objc

class SearchEngine(NSObject):
    def init(self):
        self = objc.super(SearchEngine, self).init()
        if self is None:
            return None
        
        # Initialize your Python search engine
        from search import DocumentSearchEngine
        self.engine = DocumentSearchEngine()
        return self
    
    @python_method
    def searchDocuments_(self, query):
        """Called from Swift to perform search"""
        results = self.engine.search(query, display_results=False)
        
        # Convert Python results to Objective-C compatible format
        return [
            {
                'title': chunk.metadata.get('file_name'),
                'content': chunk.content[:200],
                'score': float(score),
                'path': chunk.metadata.get('file_path')
            }
            for chunk, score in results
        ]
    
    @python_method
    def indexDirectory_(self, path):
        """Called from Swift to index a directory"""
        self.engine.index_directory(str(path))
        return True
```

## Implementation Steps

### Step 1: Create the Xcode Project

```bash
# 1. Create new macOS app in Xcode
# File → New → Project → macOS → App
# Choose SwiftUI for interface
# Name: LocalDocSearch
```

### Step 2: Set Up Python Framework

```bash
# 2. Install PyObjC in your Python environment
pip install pyobjc-core pyobjc-framework-Cocoa

# 3. Create Python.framework bundle
python3 -m py2app --make-setup PythonSearchEngine.py
python3 setup.py py2app --packages=numpy,faiss,sentence_transformers
```

### Step 3: Bridge Configuration

Create `BridgingHeader.h`:
```objc
#import <Python/Python.h>
#import <Foundation/Foundation.h>

@interface PythonSearchEngine : NSObject
- (NSArray *)searchDocuments:(NSString *)query;
- (BOOL)indexDirectory:(NSString *)path;
- (NSDictionary *)getStatistics;
@end
```

### Step 4: Swift Bridge Manager

```swift
// PythonBridge.swift
import Foundation

class PythonBridge: ObservableObject {
    static let shared = PythonBridge()
    private var searchEngine: PythonSearchEngine?
    
    init() {
        initializePython()
    }
    
    private func initializePython() {
        // Set Python home to bundled framework
        let pythonPath = Bundle.main.path(
            forResource: "Python", 
            ofType: "framework"
        )!
        
        setenv("PYTHONHOME", pythonPath, 1)
        setenv("PYTHONPATH", "\(pythonPath)/lib/python3.11", 1)
        
        // Initialize Python interpreter
        Py_Initialize()
        
        // Import and initialize search engine
        searchEngine = PythonSearchEngine()
    }
    
    func search(query: String) -> [SearchResult] {
        guard let engine = searchEngine else { return [] }
        
        let results = engine.searchDocuments(query) as? [[String: Any]] ?? []
        
        return results.compactMap { dict in
            guard let title = dict["title"] as? String,
                  let content = dict["content"] as? String,
                  let score = dict["score"] as? Double,
                  let path = dict["path"] as? String
            else { return nil }
            
            return SearchResult(
                title: title,
                content: content,
                score: score,
                path: path
            )
        }
    }
    
    func indexDirectory(at url: URL) {
        searchEngine?.indexDirectory(url.path)
    }
}
```

### Step 5: SwiftUI Views

```swift
// ContentView.swift
import SwiftUI

struct ContentView: View {
    @StateObject private var bridge = PythonBridge.shared
    @State private var searchText = ""
    @State private var results: [SearchResult] = []
    @State private var isIndexing = false
    
    var body: some View {
        NavigationSplitView {
            // Sidebar
            List {
                Section("Actions") {
                    Button("Index Folder...") {
                        selectFolderToIndex()
                    }
                    .disabled(isIndexing)
                    
                    Button("View Statistics") {
                        showStatistics()
                    }
                }
                
                Section("Recent Searches") {
                    // Recent search history
                }
            }
        } detail: {
            // Main content
            VStack {
                // Search bar
                HStack {
                    Image(systemName: "magnifyingglass")
                    TextField("Search documents...", text: $searchText)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit {
                            performSearch()
                        }
                }
                .padding()
                
                // Results list
                if results.isEmpty {
                    ContentUnavailableView(
                        "No Results",
                        systemImage: "doc.text.magnifyingglass",
                        description: Text("Try searching for something")
                    )
                } else {
                    List(results) { result in
                        SearchResultRow(result: result)
                    }
                }
            }
        }
    }
    
    func performSearch() {
        Task {
            results = await bridge.search(query: searchText)
        }
    }
    
    func selectFolderToIndex() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        
        if panel.runModal() == .OK {
            if let url = panel.url {
                Task {
                    isIndexing = true
                    await bridge.indexDirectory(at: url)
                    isIndexing = false
                }
            }
        }
    }
}
```

## Advantages of This Approach

### 1. **Native macOS Experience**
- Proper menu bar integration
- Native keyboard shortcuts (⌘F for search)
- System notifications
- Dark mode support
- macOS-style animations

### 2. **App Store Ready**
- Can be signed and notarized
- Sandboxing compatible
- App Store distribution possible
- Automatic updates via Sparkle

### 3. **Performance**
- Native UI renders at 120Hz on ProMotion displays
- Python runs in separate thread (no UI blocking)
- Efficient memory management
- Hardware acceleration for UI

### 4. **Feature Integration**
- Spotlight integration possible
- Quick Look for documents
- Share extensions
- Finder integration
- Touch Bar support (older MacBooks)

## Alternative Approaches Comparison

| Approach | Pros | Cons |
|----------|------|------|
| **SwiftUI + PyObjC** | Native UI, App Store ready, Best UX | Complex setup, Two languages |
| **Electron + FastAPI** | Web tech, Cross-platform | Large bundle (200MB+), Non-native |
| **PyQt6** | Single language, Mature | Non-native look, 100MB+ bundle |
| **Tkinter** | Built-in Python, Simple | Dated UI, Limited features |
| **py2app only** | Pure Python, Simple deployment | Limited UI capabilities |

## Project Structure

```
LocalDocSearch.xcodeproj/
LocalDocSearch/
├── App/
│   ├── LocalDocSearchApp.swift
│   └── Info.plist
├── Views/
│   ├── ContentView.swift
│   ├── SearchView.swift
│   └── SettingsView.swift
├── Bridge/
│   ├── PythonBridge.swift
│   ├── BridgingHeader.h
│   └── SearchEngine.py
├── Models/
│   ├── SearchResult.swift
│   └── Document.swift
├── Resources/
│   └── Python.framework/
│       ├── Python
│       └── lib/
│           └── python3.11/
│               ├── site-packages/
│               │   ├── faiss/
│               │   ├── sentence_transformers/
│               │   └── [your python code]
│               └── [python stdlib]
└── Assets.xcassets/
```

## Building & Distribution

### Development Build
```bash
# 1. Build Python framework
python setup.py py2app --packages=numpy,faiss,sentence_transformers

# 2. Copy to Xcode project
cp -r dist/Python.framework LocalDocSearch/Resources/

# 3. Build in Xcode
# Product → Build (⌘B)
```

### Distribution Build
```bash
# 1. Archive in Xcode
# Product → Archive

# 2. Sign with Developer ID
# Window → Organizer → Distribute App

# 3. Notarize for Gatekeeper
xcrun notarytool submit LocalDocSearch.zip \
    --keychain-profile "AC_PASSWORD" \
    --wait

# 4. Staple the notarization
xcrun stapler staple LocalDocSearch.app
```

## Example Features for macOS App

### 1. Menu Bar
```swift
.commands {
    CommandGroup(replacing: .newItem) {
        Button("Index Folder...") {
            indexFolder()
        }
        .keyboardShortcut("I", modifiers: [.command])
    }
    
    CommandMenu("Search") {
        Button("Find...") {
            showSearch()
        }
        .keyboardShortcut("F", modifiers: [.command])
        
        Button("Find Similar...") {
            findSimilar()
        }
        .keyboardShortcut("F", modifiers: [.command, .shift])
    }
}
```

### 2. Dock Integration
```swift
// Drag & drop documents onto dock icon
func application(_ sender: NSApplication, openFiles filenames: [String]) {
    for filename in filenames {
        indexFile(at: URL(fileURLWithPath: filename))
    }
}
```

### 3. Quick Look Preview
```swift
struct DocumentPreview: NSViewRepresentable {
    let url: URL
    
    func makeNSView(context: Context) -> QLPreviewView {
        let preview = QLPreviewView()
        preview.previewItem = url as QLPreviewItem
        return preview
    }
}
```

## Challenges & Solutions

### Challenge 1: Bundle Size
**Problem**: Python + ML models = 500MB+ app
**Solution**: 
- Download models on first run
- Use App Thinning
- Compress frameworks

### Challenge 2: Python Dependencies
**Problem**: Complex dependencies (NumPy, FAISS)
**Solution**:
- Use conda-pack or similar
- Pre-compile wheels
- Bundle only necessary files

### Challenge 3: Debugging
**Problem**: Hard to debug Python in Xcode
**Solution**:
- Use Console.app for Python logs
- Remote Python debugger (debugpy)
- Comprehensive error handling

## User Installation Experience

### What Users See - The Magic ✨

**Users DO NOT need to install:**
- ❌ Python
- ❌ pip or conda
- ❌ FAISS, NumPy, or any Python packages
- ❌ Ollama (embedded models)
- ❌ Command line tools
- ❌ Virtual environments

**What users actually do:**

### Installation Method 1: Direct Download
```
1. Download LocalDocSearch.dmg from website (one file, ~300-500MB)
2. Open the DMG file
3. Drag LocalDocSearch to Applications folder
4. Double-click to launch
5. Done! ✅
```

<img width="400" alt="Standard macOS DMG installer window showing app icon and Applications folder">

### Installation Method 2: Mac App Store
```
1. Open Mac App Store
2. Search "LocalDocSearch"
3. Click "Get" or "Install"
4. Launch from Launchpad
5. Done! ✅
```

### Installation Method 3: Homebrew Cask
```bash
brew install --cask localdocsearch
# Done! ✅
```

## First Launch Experience

### Step 1: macOS Gatekeeper
```
First launch only:
- macOS: "LocalDocSearch is an app downloaded from the internet. 
         Are you sure you want to open it?"
- User clicks "Open"
- Never asked again
```

### Step 2: Permissions Request
```swift
// App requests folder access permission
"LocalDocSearch would like to access your Documents folder"
[Don't Allow] [OK]

// This is standard macOS privacy protection
```

### Step 3: Welcome Screen
```
Welcome to LocalDocSearch!

Let's get started:
[✓] App is installed and ready
[✓] Python environment is embedded
[✓] Search models are included

Click "Index First Folder" to begin
[Index Folder] [Skip]
```

## Behind The Scenes - Bundle Structure

When users install your app, they get a single `.app` bundle containing EVERYTHING:

```
LocalDocSearch.app/
├── Contents/
│   ├── Info.plist
│   ├── MacOS/
│   │   └── LocalDocSearch (main executable)
│   ├── Frameworks/
│   │   ├── Python.framework/
│   │   │   ├── Python (Python 3.11 interpreter - 15MB)
│   │   │   └── Versions/3.11/
│   │   │       └── lib/python3.11/
│   │   │           ├── site-packages/
│   │   │           │   ├── numpy/ (20MB)
│   │   │           │   ├── faiss/ (50MB)
│   │   │           │   ├── sentence_transformers/ (30MB)
│   │   │           │   ├── torch/ (150MB if included)
│   │   │           │   └── [your search code]
│   │   │           └── [Python standard library]
│   │   └── [Swift runtime libraries]
│   ├── Resources/
│   │   ├── Models/
│   │   │   └── all-MiniLM-L6-v2/ (90MB)
│   │   ├── Assets.xcassets/
│   │   └── [icons, images]
│   └── _CodeSignature/
```

**Total Size**: ~300-500MB depending on models

## How Self-Contained Apps Work

### py2app Magic
`py2app` does the heavy lifting:

```python
# setup.py for py2app
from setuptools import setup

APP = ['PythonSearchEngine.py']
DATA_FILES = ['models', 'config.yaml']
OPTIONS = {
    'packages': [
        'numpy', 
        'faiss', 
        'sentence_transformers',
        'torch',  # If needed
        'langchain',
        'PyPDF2',
        'docx'
    ],
    'includes': ['your_search_module'],
    'frameworks': [],
    'plist': {
        'CFBundleName': 'LocalDocSearch',
        'CFBundleVersion': '1.0.0',
    },
    'compressed': True,  # Reduces size
    'optimize': 2,  # Python optimization
}

setup(
    app=APP,
    data_files=DATA_FILES,
    options={'py2app': OPTIONS},
    setup_requires=['py2app'],
)
```

### What py2app Bundles

1. **Python Interpreter**: Full Python runtime (~15MB compressed)
2. **All Dependencies**: Every pip package your app needs
3. **Compiled Bytecode**: `.pyc` files for faster startup
4. **Native Libraries**: `.dylib` files for NumPy, FAISS
5. **Models**: Embedding models (can be downloaded on first run to save space)

## Size Optimization Strategies

### Option 1: Full Bundle (Simplest)
- **Size**: 400-500MB
- **Pros**: Everything included, works offline immediately
- **Cons**: Large download

### Option 2: Download Models on First Run
```swift
struct FirstRunView: View {
    @State private var downloadProgress = 0.0
    
    var body: some View {
        VStack {
            Text("Downloading search models...")
            ProgressView(value: downloadProgress)
            Text("\(Int(downloadProgress * 100))%")
        }
        .onAppear {
            downloadModels()
        }
    }
    
    func downloadModels() {
        // Download from your server or Hugging Face
        // Save to ~/Library/Application Support/LocalDocSearch/
    }
}
```
- **Initial Size**: 150MB
- **After Setup**: 400MB
- **Pros**: Smaller initial download
- **Cons**: Requires internet on first run

### Option 3: Use System Python (NOT Recommended)
- Would require users to install Python
- Loses self-contained nature
- Not App Store compatible

## Comparison with Other Approaches

| Distribution Method | User Install Steps | Prerequisites | Size | 
|-------------------|-------------------|---------------|------|
| **Native App Bundle** | 1. Drag to Applications | None | 300-500MB |
| **Current CLI** | 1. Install Python<br>2. Install pip packages<br>3. Run setup.sh<br>4. Debug issues | Python, Terminal knowledge | 50MB + Python |
| **Electron App** | 1. Drag to Applications | None | 200-300MB |
| **Web App** | 1. Open browser | Web browser | 0MB (cloud) |

## Code Signing & Notarization

For users to run without scary warnings:

```bash
# 1. Sign the app with Developer ID
codesign --deep --force --verify --verbose \
    --sign "Developer ID Application: Your Name" \
    --options runtime \
    --entitlements LocalDocSearch.entitlements \
    LocalDocSearch.app

# 2. Create DMG
create-dmg \
    --volname "LocalDocSearch" \
    --window-size 600 400 \
    --icon-size 100 \
    --icon "LocalDocSearch.app" 200 150 \
    --app-drop-link 400 150 \
    "LocalDocSearch.dmg" \
    "LocalDocSearch.app"

# 3. Notarize with Apple
xcrun notarytool submit LocalDocSearch.dmg \
    --keychain-profile "notarytool-profile" \
    --wait

# 4. Staple the ticket
xcrun stapler staple LocalDocSearch.dmg
```

## User Experience Timeline

```
T+0s:   User double-clicks LocalDocSearch.dmg
T+2s:   DMG mounts, shows drag-to-install window
T+5s:   User drags to Applications
T+10s:  Copy completes
T+12s:  User double-clicks app icon
T+13s:  Gatekeeper verification (first run only)
T+15s:  App launches with welcome screen
T+20s:  User selects folder to index
T+25s:  Indexing begins (no setup needed!)
```

## Auto-Update System

Using Sparkle framework for updates:

```swift
import Sparkle

class AppDelegate: NSObject, NSApplicationDelegate {
    @IBOutlet var updater: SPUUpdater!
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        updater.automaticallyChecksForUpdates = true
        updater.updateCheckInterval = 86400 // Daily
    }
}
```

Users see:
```
"A new version of LocalDocSearch is available!
Version 1.2.0 includes performance improvements.

[Install Update] [Skip This Version] [Remind Me Later]"
```

## Troubleshooting for Users

### Common Issues and Solutions

**"App can't be opened because it is from an unidentified developer"**
- Right-click app → Open → Open (bypasses Gatekeeper)
- Or: System Settings → Privacy & Security → Open Anyway

**"App is damaged and can't be opened"**
- Usually means not properly signed/notarized
- Terminal: `xattr -cr /Applications/LocalDocSearch.app`

**"Python modules not found" errors**
- Should NEVER happen with proper bundling
- If it does: Reinstall app (bundle was corrupted)

## The Dream User Experience

```markdown
Sarah, a lawyer, needs to search through thousands of case documents:

1. 💻 Googles "local document search mac"
2. 🔍 Finds LocalDocSearch website
3. ⬇️ Downloads LocalDocSearch.dmg (2 minutes on average connection)
4. 📁 Drags to Applications (5 seconds)
5. 🚀 Launches app
6. 📂 Selects her Documents/Cases folder
7. ☕ Gets coffee while indexing (10 minutes for 5000 documents)
8. 🔎 Searches "patent infringement precedent"
9. 📄 Instantly finds relevant cases
10. 😊 No Python, no Terminal, no pip, no problems!

Total setup time: < 15 minutes
Technical knowledge required: None
```

## Next Steps

1. **Prototype**: Start with simple search UI
2. **Bundle Python**: Get py2app working
3. **Bridge Basic Functions**: Search and index
4. **Polish UI**: Add native macOS features
5. **Optimize**: Reduce bundle size
6. **Distribute**: Sign and notarize

## Resources

- [PyObjC Documentation](https://pyobjc.readthedocs.io/)
- [py2app Documentation](https://py2app.readthedocs.io/)
- [SwiftUI Tutorials](https://developer.apple.com/tutorials/swiftui)
- [Distributing macOS Apps](https://developer.apple.com/documentation/xcode/distributing-your-app)

This approach gives you a **truly native macOS app** with all the benefits of your Python search engine!