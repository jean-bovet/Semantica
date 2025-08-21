//
//  SearchView.swift
//  FinderSemanticSearch
//
//  Main search interface
//

import SwiftUI
import UniformTypeIdentifiers

struct SearchView: View {
    @StateObject private var viewModel = SearchViewModel()
    @State private var showingFolderPicker = false
    @FocusState private var searchFieldFocused: Bool
    
    var body: some View {
        VStack(spacing: 0) {
            // Header with dropdown menu
            headerBar
                .padding()
            
            Divider()
            
            // Search Bar
            searchBar
                .padding()
            
            Divider()
            
            // Results or Empty State
            if viewModel.isSearching {
                ProgressView("Searching...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.searchResults.isEmpty {
                emptyState
            } else {
                resultsList
            }
            
            Spacer()
            
            // Status Bar (always visible at bottom)
            StatusBarView(viewModel: viewModel)
        }
        .frame(minWidth: 600, minHeight: 400)
        .task {
            await viewModel.initialize()
        }
        .fileImporter(
            isPresented: $showingFolderPicker,
            allowedContentTypes: [.folder],
            onCompletion: handleFolderSelection
        )
        // Remove modal sheet - no longer needed
        // .sheet(isPresented: $showingIndexSheet) {
        //     IndexingView(viewModel: viewModel)
        // }
        .alert("Error", isPresented: .constant(viewModel.errorMessage != nil && !viewModel.errorMessage!.starts(with: "Indexed"))) {
            Button("OK") {
                viewModel.errorMessage = nil
            }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }
    
    // MARK: - Components
    
    private var headerBar: some View {
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
                        Task {
                            await viewModel.clearIndex()
                        }
                    }
                    .foregroundColor(.red)
                }
            } label: {
                Label("Index Folder", systemImage: "folder.badge.plus")
            }
            .menuStyle(.borderlessButton)
            .disabled(viewModel.isIndexing)
        }
    }
    
    private func handleFolderSelection(_ result: Result<URL, Error>) {
        switch result {
        case .success(let url):
            // Start indexing in background (non-blocking)
            Task {
                await viewModel.indexFolder(url)
            }
        case .failure(let error):
            print("Folder selection error: \(error)")
        }
    }
    
    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)
            
            TextField("Search documents...", text: $viewModel.searchQuery)
                .textFieldStyle(.plain)
                .font(.title3)
            
            if !viewModel.searchQuery.isEmpty {
                Button(action: { viewModel.searchQuery = "" }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(8)
    }
    
    private var emptyState: some View {
        VStack(spacing: 20) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 64))
                .foregroundColor(.secondary)
            
            if viewModel.statistics?.totalDocuments == 0 {
                Text("No documents indexed")
                    .font(.title2)
                
                Text("Click 'Index Folder' to get started")
                    .foregroundColor(.secondary)
                
                Button("Index Folder") {
                    showingFolderPicker = true
                }
                .buttonStyle(.borderedProminent)
            } else {
                Text("Start typing to search")
                    .font(.title2)
                    .foregroundColor(.secondary)
                
                if let stats = viewModel.statistics {
                    Text("\(stats.totalDocuments) documents indexed")
                        .font(.caption)
                        .foregroundColor(Color.secondary.opacity(0.5))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    private var resultsList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(viewModel.searchResults) { result in
                    SearchResultRow(result: result, viewModel: viewModel)
                    Divider()
                }
            }
        }
    }
}

// MARK: - Search Result Row

struct SearchResultRow: View {
    let result: SearchResult
    let viewModel: SearchViewModel
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // File icon
            Image(systemName: fileIcon)
                .font(.title2)
                .foregroundColor(.accentColor)
                .frame(width: 32)
            
            // Content
            VStack(alignment: .leading, spacing: 4) {
                Text(result.fileName)
                    .font(.headline)
                    .lineLimit(1)
                
                Text(result.preview)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
                
                HStack {
                    Text(result.filePath)
                        .font(.caption2)
                        .foregroundColor(Color.secondary.opacity(0.5))
                        .lineLimit(1)
                    
                    Spacer()
                    
                    if let page = result.pageNumber {
                        Text("Page \(page)")
                            .font(.caption2)
                            .foregroundColor(Color.secondary.opacity(0.5))
                    }
                    
                    Text(String(format: "%.1f%%", result.score * 100))
                        .font(.caption2)
                        .foregroundColor(Color.secondary.opacity(0.5))
                }
            }
            
            // Actions
            HStack(spacing: 4) {
                Button(action: { viewModel.openFile(result) }) {
                    Image(systemName: "arrow.up.forward.square")
                }
                .buttonStyle(.borderless)
                .help("Open file")
                
                Button(action: { viewModel.revealInFinder(result) }) {
                    Image(systemName: "folder")
                }
                .buttonStyle(.borderless)
                .help("Reveal in Finder")
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .contentShape(Rectangle())
        .onTapGesture(count: 2) {
            viewModel.openFile(result)
        }
    }
    
    private var fileIcon: String {
        let ext = URL(fileURLWithPath: result.filePath).pathExtension.lowercased()
        switch ext {
        case "pdf":
            return "doc.richtext"
        case "doc", "docx":
            return "doc.text"
        case "txt", "md":
            return "doc.plaintext"
        default:
            return "doc"
        }
    }
}

#Preview {
    SearchView()
}