//
//  SearchViewModel.swift
//  FinderSemanticSearch
//
//  View model for search functionality
//

import Foundation
import SwiftUI
import Combine

@MainActor
class SearchViewModel: ObservableObject {
    @Published var searchQuery = ""
    @Published var searchResults: [SearchResult] = []
    @Published var isSearching = false
    @Published var isIndexing = false
    @Published var errorMessage: String?
    @Published var statistics: IndexStatistics?
    @Published var indexedFolders: [URL] = []
    
    // Progress tracking for indexing
    @Published var indexingTotalFiles: Int = 0
    @Published var indexingCurrentFile: Int = 0
    @Published var currentIndexingFile: String = ""
    
    private let bridge = PythonCLIBridge()
    private var searchCancellable: AnyCancellable?
    
    init() {
        setupSearchDebouncing()
    }
    
    // MARK: - Setup
    
    func initialize() async {
        print("SearchViewModel: Initializing...")
        do {
            print("SearchViewModel: Starting Python bridge...")
            try await bridge.start()
            print("SearchViewModel: Python bridge started successfully")
            await refreshStatistics()
            print("SearchViewModel: Statistics refreshed")
        } catch {
            print("SearchViewModel: Failed to start - \(error)")
            errorMessage = "Failed to start search engine: \(error.localizedDescription)"
        }
    }
    
    private func setupSearchDebouncing() {
        searchCancellable = $searchQuery
            .debounce(for: .milliseconds(300), scheduler: RunLoop.main)
            .removeDuplicates()
            .sink { [weak self] query in
                Task {
                    await self?.performSearch(query)
                }
            }
    }
    
    // MARK: - Search
    
    private func performSearch(_ query: String) async {
        guard !query.isEmpty else {
            searchResults = []
            return
        }
        
        isSearching = true
        errorMessage = nil
        
        do {
            searchResults = try await bridge.search(query, limit: 20)
        } catch {
            errorMessage = "Search failed: \(error.localizedDescription)"
            searchResults = []
        }
        
        isSearching = false
    }
    
    // MARK: - Indexing
    
    func indexFolder(_ url: URL) async {
        isIndexing = true
        errorMessage = nil
        
        // Reset progress tracking
        indexingTotalFiles = 0
        indexingCurrentFile = 0
        currentIndexingFile = ""
        
        print("Starting to index folder: \(url.path)")
        
        do {
            let result = try await bridge.indexFolder(url) { [weak self] current, total, fileName in
                // Update progress on main thread
                Task { @MainActor in
                    self?.indexingCurrentFile = current
                    self?.indexingTotalFiles = total
                    self?.currentIndexingFile = fileName
                }
            }
            
            indexedFolders.append(url)
            await refreshStatistics()
            
            print("Successfully indexed \(result.documents) documents with \(result.chunks) chunks")
            
            // Show success message
            errorMessage = "Indexed \(result.documents) documents (\(result.chunks) chunks)"
            
            // Clear message after 3 seconds
            Task {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if errorMessage?.starts(with: "Indexed") == true {
                    errorMessage = nil
                }
            }
            
        } catch {
            print("Indexing error: \(error)")
            errorMessage = "Indexing failed: \(error.localizedDescription)"
        }
        
        // Reset progress tracking
        isIndexing = false
        indexingTotalFiles = 0
        indexingCurrentFile = 0
        currentIndexingFile = ""
    }
    
    // MARK: - Management
    
    func refreshStatistics() async {
        do {
            statistics = try await bridge.getStatistics()
        } catch {
            // Statistics might fail if index doesn't exist yet
            statistics = nil
        }
    }
    
    func clearIndex() async {
        do {
            try await bridge.clearIndex()
            searchResults = []
            indexedFolders = []
            await refreshStatistics()
            errorMessage = "Index cleared"
            
            // Clear message after 2 seconds
            Task {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if errorMessage == "Index cleared" {
                    errorMessage = nil
                }
            }
            
        } catch {
            errorMessage = "Failed to clear index: \(error.localizedDescription)"
        }
    }
    
    func openFile(_ result: SearchResult) {
        let url = URL(fileURLWithPath: result.filePath)
        NSWorkspace.shared.open(url)
    }
    
    func revealInFinder(_ result: SearchResult) {
        let url = URL(fileURLWithPath: result.filePath)
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }
    
    deinit {
        Task { @MainActor in
            bridge.stop()
        }
    }
}