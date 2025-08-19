import SwiftUI

@main
struct LocalDocSearchApp: App {
    @StateObject private var searchEngine = SearchEngineManager.shared
    @StateObject private var appState = AppState()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(searchEngine)
                .environmentObject(appState)
                .frame(minWidth: 900, minHeight: 600)
                .onAppear {
                    setupApp()
                }
        }
        .windowStyle(.automatic)
        .windowToolbarStyle(.unified)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Index Folder...") {
                    appState.showingIndexSheet = true
                }
                .keyboardShortcut("i", modifiers: [.command])
                
                Divider()
                
                Button("Clear Index") {
                    searchEngine.clearIndex()
                }
                .keyboardShortcut("k", modifiers: [.command, .shift])
            }
            
            CommandMenu("Search") {
                Button("Focus Search") {
                    appState.focusSearch = true
                }
                .keyboardShortcut("f", modifiers: [.command])
                
                Button("Clear Results") {
                    appState.searchResults.removeAll()
                }
                .keyboardShortcut("l", modifiers: [.command])
                
                Divider()
                
                Button("Search Settings...") {
                    appState.showingSettings = true
                }
                .keyboardShortcut(",", modifiers: [.command])
            }
        }
        
        Settings {
            SettingsView()
                .environmentObject(searchEngine)
        }
    }
    
    private func setupApp() {
        Task {
            await searchEngine.initialize()
        }
    }
}

class AppState: ObservableObject {
    @Published var searchQuery = ""
    @Published var searchResults: [SearchResult] = []
    @Published var selectedResult: SearchResult?
    @Published var isSearching = false
    @Published var isIndexing = false
    @Published var showingIndexSheet = false
    @Published var showingSettings = false
    @Published var focusSearch = false
    @Published var indexProgress: Double = 0
    @Published var statusMessage = "Ready"
}