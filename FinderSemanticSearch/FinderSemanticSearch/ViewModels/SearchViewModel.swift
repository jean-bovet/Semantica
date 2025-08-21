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
    @Published var indexedFolders: [IndexedFolder] = []
    
    // Progress tracking for indexing
    @Published var indexingTotalFiles: Int = 0
    @Published var indexingCurrentFile: Int = 0
    @Published var currentIndexingFile: String = ""
    
    private let bridge = PythonCLIBridge()
    private var searchCancellable: AnyCancellable?
    private let indexedFoldersKey = "com.finderSemanticSearch.indexedFolders"
    
    init() {
        setupSearchDebouncing()
        loadIndexedFolders()
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
                Task { [weak self] in
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
            
            // Only add if not already in the list
            if !indexedFolders.contains(where: { $0.url == url }) {
                indexedFolders.append(IndexedFolder(url: url, indexedAt: Date()))
                saveIndexedFolders()
            }
            await refreshStatistics()
            
            print("Successfully indexed \(result.documents) documents with \(result.chunks) chunks")
            
            // Show success message
            errorMessage = "Indexed \(result.documents) documents (\(result.chunks) chunks)"
            
            // Clear message after 3 seconds
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                await MainActor.run {
                    if self?.errorMessage?.starts(with: "Indexed") == true {
                        self?.errorMessage = nil
                    }
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
            saveIndexedFolders()  // Clear saved folders
            await refreshStatistics()
            errorMessage = "Index cleared"
            
            // Clear message after 2 seconds
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                await MainActor.run {
                    if self?.errorMessage == "Index cleared" {
                        self?.errorMessage = nil
                    }
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
    
    // MARK: - Persistence
    
    private func saveIndexedFolders() {
        do {
            let encoder = JSONEncoder()
            let data = try encoder.encode(indexedFolders)
            UserDefaults.standard.set(data, forKey: indexedFoldersKey)
            print("Saved \(indexedFolders.count) indexed folders to UserDefaults")
        } catch {
            print("Failed to save indexed folders: \(error)")
        }
    }
    
    private func loadIndexedFolders() {
        guard let data = UserDefaults.standard.data(forKey: indexedFoldersKey) else {
            print("No saved indexed folders found")
            return
        }
        
        do {
            let decoder = JSONDecoder()
            indexedFolders = try decoder.decode([IndexedFolder].self, from: data)
            print("Loaded \(indexedFolders.count) indexed folders from UserDefaults")
        } catch {
            print("Failed to load indexed folders: \(error)")
            indexedFolders = []
        }
    }
    
    deinit {
        // Stop the bridge synchronously in deinit
        // Since bridge is @MainActor, we need to dispatch to main queue
        DispatchQueue.main.async { [bridge] in
            bridge.stop()
        }
    }
}