# Non-Modal Indexing UI Enhancement Plan

## Executive Summary

**Goal**: Replace modal indexing dialog with always-visible status bar showing background indexing progress.

**Key Features**:
- ✅ Non-blocking indexing (search while indexing)
- ✅ Always-visible status bar at bottom
- ✅ Single folder indexing (new cancels previous)
- ✅ Incremental indexing (already implemented in Python)
- ✅ Clean stop on app quit (no complex state management)
- ✅ Dropdown menu shows indexed folders (Option B selected)

**Implementation Time**: ~2 hours

**Simplicity Focus**: Minimal changes, reuse existing code, no complex state management.

## Overview
Transform the current modal indexing dialog into a non-blocking experience with background indexing and always-visible status bar progress display, allowing users to search while indexing is in progress.

## Current State
- **Modal Dialog**: Indexing shows a modal sheet that blocks all interaction
- **Progress Display**: Progress is shown in the modal with file counts
- **Blocking**: User cannot search or use the app during indexing

## Proposed State
- **Non-Modal**: Click "Index Folder" → Folder picker → Immediate return to main UI
- **Status Bar**: Always-visible bottom status bar shows indexing progress
- **Non-Blocking**: User can search while indexing happens in background
- **Single Folder**: Only one folder can be indexed at a time (new indexing cancels previous)
- **Incremental**: Existing index is preserved; only new/modified files are indexed
- **Cancellable**: Option to cancel ongoing indexing operation

## Implementation Plan

### 1. Simple Status Bar Component (`StatusBarView.swift`)
```swift
struct StatusBarView: View {
    @ObservedObject var viewModel: SearchViewModel
    
    var body: some View {
        HStack(spacing: 12) {
            // Left side: Status icon and text
            Image(systemName: statusIcon)
                .foregroundColor(statusColor)
            
            Text(statusText)
                .font(.caption)
                .lineLimit(1)
            
            Spacer()
            
            // Right side: Progress or stats
            if viewModel.isIndexing {
                // Show progress
                ProgressView(value: viewModel.indexingProgress)
                    .progressViewStyle(.linear)
                    .frame(width: 150)
                
                Text("\(viewModel.currentFileIndex)/\(viewModel.totalFiles)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                
                Button("Cancel") {
                    viewModel.cancelIndexing()
                }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundColor(.red)
            } else if viewModel.totalDocuments > 0 {
                // Show document count when idle
                Text("\(viewModel.totalDocuments) documents")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color(NSColor.controlBackgroundColor))
        .overlay(
            Divider(), alignment: .top
        )
    }
    
    private var statusIcon: String {
        if viewModel.isIndexing {
            return "arrow.triangle.2.circlepath"
        } else if viewModel.totalDocuments > 0 {
            return "checkmark.circle.fill"
        } else {
            return "magnifyingglass"
        }
    }
    
    private var statusColor: Color {
        if viewModel.isIndexing {
            return .blue
        } else if viewModel.totalDocuments > 0 {
            return .green
        } else {
            return .secondary
        }
    }
    
    private var statusText: String {
        if viewModel.isIndexing {
            // Show only filename
            let fileName = URL(fileURLWithPath: viewModel.currentFileName).lastPathComponent
            return "Indexing: \(fileName)"
        } else if viewModel.totalDocuments > 0 {
            return "Ready to search"
        } else {
            return "No index - Click 'Index Folder' to start"
        }
    }
}
```

### 2. Indexed Folders Display - Dropdown Menu (Selected)

```swift
// Replace simple "Index Folder" button with dropdown menu
Menu {
    Button("Index New Folder...") {
        showingFolderPicker = true
    }
    
    if !viewModel.indexedFolders.isEmpty {
        Divider()
        
        // Show recent indexed folders
        ForEach(viewModel.indexedFolders) { folder in
            Button(action: {
                Task {
                    await viewModel.reindexFolder(folder.url)
                }
            }) {
                HStack {
                    Text(folder.url.lastPathComponent)
                    Spacer()
                    Text(folder.indexedAt, style: .date)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        
        Divider()
        
        // Clear all option
        Button("Clear All Indexes") {
            viewModel.clearIndex()
        }
        .foregroundColor(.red)
    }
} label: {
    Label("Index Folder", systemImage: "folder.badge.plus")
}
.menuStyle(.borderlessButton)
.frame(width: 120)
```

**Benefits of Dropdown Menu Approach**:
- Clean UI - doesn't add clutter
- Quick access to re-index recent folders
- Shows last indexed date for each folder
- Easy "Clear All" option
- Familiar macOS pattern

### 3. Updated ContentView Structure
```swift
struct ContentView: View {
    @StateObject private var viewModel = SearchViewModel()
    @State private var showingFolderPicker = false
    
    var body: some View {
        VStack(spacing: 0) {
            // Header with dropdown menu for indexing
            HStack {
                Text("🔍 Finder Semantic Search")
                    .font(.headline)
                
                Spacer()
                
                // Dropdown menu for index operations
                Menu {
                    Button("Index New Folder...") {
                        showingFolderPicker = true
                    }
                    
                    if !viewModel.indexedFolders.isEmpty {
                        Divider()
                        
                        ForEach(viewModel.indexedFolders) { folder in
                            Button(action: {
                                Task {
                                    await viewModel.reindexFolder(folder.url)
                                }
                            }) {
                                HStack {
                                    Text(folder.url.lastPathComponent)
                                    Spacer()
                                    Text(folder.indexedAt, style: .date)
                                        .font(.caption)
                                }
                            }
                        }
                        
                        Divider()
                        
                        Button("Clear All Indexes") {
                            viewModel.clearIndex()
                        }
                        .foregroundColor(.red)
                    }
                } label: {
                    Label("Index Folder", systemImage: "folder.badge.plus")
                }
                .menuStyle(.borderlessButton)
                .disabled(viewModel.isIndexing)  // Disable during indexing
            }
            .padding()
            
            // Main content area
            VStack(spacing: 20) {
                // Search bar (always enabled)
                SearchBarView(
                    searchText: $viewModel.searchText,
                    onSearch: viewModel.performSearch,
                    isSearching: viewModel.isSearching
                )
                
                // Search results or welcome view
                if viewModel.searchResults.isEmpty && !viewModel.hasSearched {
                    WelcomeView()
                } else {
                    SearchResultsView(results: viewModel.searchResults)
                }
            }
            .padding()
            
            Spacer()
            
            // Status bar at bottom (always visible)
            StatusBarView(viewModel: viewModel)
        }
        .frame(minWidth: 800, minHeight: 600)
        .fileImporter(
            isPresented: $showingFolderPicker,
            allowedContentTypes: [.folder],
            onCompletion: handleFolderSelection
        )
    }
    
    private func handleFolderSelection(_ result: Result<URL, Error>) {
        switch result {
        case .success(let url):
            // Start indexing in background (non-blocking)
            Task {
                await viewModel.indexFolder(url: url)
            }
        case .failure(let error):
            print("Folder selection error: \(error)")
        }
    }
}
```

### 4. Simplified SearchViewModel Updates
```swift
@MainActor
class SearchViewModel: ObservableObject {
    // Existing properties remain...
    
    // Add these new properties for non-modal indexing
    @Published var isIndexing = false
    @Published var indexingProgress: Double = 0
    @Published var currentFileIndex = 0
    @Published var totalFiles = 0
    @Published var currentFileName = ""
    @Published var lastIndexedFolder: URL?
    
    private var indexingTask: Task<Void, Never>?
    
    // Simple folder indexing (replaces modal version)
    func indexFolder(url: URL) async {
        // Cancel any existing indexing (single folder only)
        indexingTask?.cancel()
        
        // Start new indexing
        isIndexing = true
        indexingProgress = 0
        currentFileIndex = 0
        totalFiles = 0
        lastIndexedFolder = url
        
        indexingTask = Task {
            do {
                // Get folder access
                let gotAccess = url.startAccessingSecurityScopedResource()
                defer {
                    if gotAccess {
                        url.stopAccessingSecurityScopedResource()
                    }
                }
                
                // Index folder with progress updates
                try await pythonBridge.indexFolder(
                    at: url,
                    progressHandler: { [weak self] current, total, fileName in
                        guard let self = self else { return }
                        
                        // Update UI on main thread
                        Task { @MainActor in
                            self.currentFileIndex = current
                            self.totalFiles = total
                            self.currentFileName = fileName
                            
                            if total > 0 {
                                self.indexingProgress = Double(current) / Double(total)
                            }
                        }
                    }
                )
                
                // Update statistics when done
                await refreshStatistics()
                
                // Store indexed folder
                if !indexedFolders.contains(where: { $0.url == url }) {
                    indexedFolders.append(IndexedFolder(url: url))
                    saveIndexedFolders()
                }
                
            } catch {
                // Handle cancellation silently
                if !Task.isCancelled {
                    print("Indexing error: \(error)")
                }
            }
            
            // Clean up
            isIndexing = false
        }
    }
    
    // Re-index existing folder
    func reindexFolder(_ url: URL) async {
        await indexFolder(url: url)  // Same as new folder (incremental handles it)
    }
    
    // Simple cancel
    func cancelIndexing() {
        indexingTask?.cancel()
        isIndexing = false
    }
}
```

### 5. Final Visual Design

```
┌─────────────────────────────────────────────────────────┐
│  🔍 Finder Semantic Search         [Index Folder ▼] 📁 │
│                                    ┌─────────────────┐ │
│                                    │ Index New Folder │ │
│                                    ├─────────────────┤ │
│                                    │ 📁 Documents     │ │
│                                    │    2 hours ago   │ │
│                                    │ 📁 Projects      │ │
│                                    │    Yesterday     │ │
│                                    ├─────────────────┤ │
│                                    │ Clear All        │ │
│                                    └─────────────────┘ │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [     Search documents...                    ] 🔍     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │ Search Results                                   │  │
│  │                                                  │  │
│  │ 📄 Document1.pdf (Score: 0.95)                  │  │
│  │    Preview text here...                         │  │
│  │                                                  │  │
│  │ 📄 Document2.docx (Score: 0.87)                 │  │
│  │    Preview text here...                         │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ 🔄 Indexing: file.pdf  [████████░░] 42/100  [Cancel]  │
└─────────────────────────────────────────────────────────┘
     Status Bar (always visible at bottom)
```


### 6. Benefits

1. **Non-Blocking UX**: Users can search immediately while indexing happens
2. **Better Visibility**: Status bar always shows system state
3. **Incremental Updates**: Don't re-index unchanged files (already implemented in Python backend)
4. **Cancellable**: Users can stop long indexing operations
5. **Concurrent Operations**: Leverages async CLI for parallel operations
6. **Clean Interface**: No modal dialogs interrupting workflow

### 7. Simple Implementation Steps

**Step 1: Add Status Bar (30 minutes)**
1. Create `StatusBarView.swift` with the simple component above
2. Add to bottom of `ContentView` (always visible)
3. Wire up to existing ViewModel properties

**Step 2: Update Index Button (15 minutes)**
1. Change to dropdown menu (Option B recommended)
2. Shows "Index New Folder..." and recent folders
3. Re-index by clicking a recent folder

**Step 3: Modify ViewModel (30 minutes)**
1. Add new `@Published` properties for indexing state
2. Change `indexFolder()` to non-blocking version above
3. Remove modal-related code
4. Add `cancelIndexing()` method

**Step 4: Remove Modal (15 minutes)**
1. Delete `IndexingView.swift` (no longer needed)
2. Remove `.sheet` modifier from ContentView
3. Remove `showingIndexing` state variable

**Step 5: Test (30 minutes)**
1. Test indexing progress in status bar
2. Test searching while indexing
3. Test cancel button
4. Test re-indexing (should be fast - incremental)

**Total: ~2 hours for complete implementation**

### 8. Future Enhancements (Not in Initial Implementation)

1. ~~**Multiple Folder Queue**~~ - Single folder only as per requirements
2. **Pause/Resume**: Ability to pause and resume indexing
3. **Indexing History**: Show recently indexed folders
4. ~~**Progress Persistence**~~ - Index data persists via metadata_store
5. **Notification**: System notification when indexing completes

### 9. Migration Path

To avoid breaking existing functionality:
1. Implement StatusBarView first (additive change)
2. Add background indexing support to ViewModel
3. Test thoroughly with both approaches
4. Remove modal approach once confident

## How Incremental Indexing Works (Already Implemented)

The Python backend already has full incremental indexing support via `metadata_store.py`:

1. **First Index**: All files in folder are indexed
2. **Subsequent Indexes**: Only processes:
   - New files (not previously indexed)
   - Modified files (changed size/timestamp/hash)
   - Removes deleted files from index
3. **Unchanged Files**: Skipped automatically
4. **Metadata Storage**: SQLite database tracks:
   - File paths, sizes, modification times
   - Document IDs and chunk mappings
   - Vector indices in FAISS

This means:
- ✅ Re-indexing same folder is fast (only changes processed)
- ✅ Index data persists between app launches
- ✅ No duplicate processing of unchanged files
- ✅ FAISS index and metadata stay in sync

## Final Design Decisions

1. ✅ **Status Bar**: Always visible at bottom
2. ✅ **File Display**: Show filename only (not full path)
3. ✅ **Folder Limit**: Single folder indexing at a time
4. ✅ **Indexed Folders**: Dropdown menu shows recent folders (Option B)
5. ✅ **Persistence**: Index data persists (incremental indexing already implemented)
6. ✅ **App Quit**: Clean stop - no complex state management
   - Indexing stops immediately when app quits
   - Next time user indexes same folder, incremental indexing picks up where it left off

## Next Steps

After your review and feedback:
1. Implement StatusBarView component
2. Update SearchViewModel for background indexing
3. Modify ContentView to use new approach
4. Test concurrent operations thoroughly
5. Add polish and animations