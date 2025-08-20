//
//  SearchView.swift
//  FinderSemanticSearch
//
//  Main search interface
//

import SwiftUI

struct SearchView: View {
    @StateObject private var viewModel = SearchViewModel()
    @State private var showingIndexSheet = false
    
    var body: some View {
        VStack(spacing: 0) {
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
            
            // Bottom Bar
            Divider()
            bottomBar
                .padding(.horizontal)
                .padding(.vertical, 8)
        }
        .frame(minWidth: 600, minHeight: 400)
        .task {
            await viewModel.initialize()
        }
        .sheet(isPresented: $showingIndexSheet) {
            IndexingView(viewModel: viewModel)
        }
        .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
            Button("OK") {
                viewModel.errorMessage = nil
            }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }
    
    // MARK: - Components
    
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
                    showingIndexSheet = true
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
    
    private var bottomBar: some View {
        HStack {
            if let stats = viewModel.statistics {
                Label("\(stats.totalDocuments) documents", systemImage: "doc.fill")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            Button(action: { showingIndexSheet = true }) {
                Label("Index Folder", systemImage: "plus.circle")
            }
            .buttonStyle(.borderless)
            
            Button(action: {
                Task { await viewModel.clearIndex() }
            }) {
                Label("Clear Index", systemImage: "trash")
            }
            .buttonStyle(.borderless)
            .disabled(viewModel.statistics?.totalDocuments == 0)
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