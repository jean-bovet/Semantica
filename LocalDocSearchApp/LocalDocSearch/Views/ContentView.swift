import SwiftUI

struct ContentView: View {
    @EnvironmentObject var searchEngine: SearchEngineManager
    @EnvironmentObject var appState: AppState
    @FocusState private var searchFieldFocused: Bool
    
    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 250, ideal: 300, max: 400)
        } detail: {
            VStack(spacing: 0) {
                SearchBarView(searchFieldFocused: $searchFieldFocused)
                    .padding()
                    .background(Color(NSColor.controlBackgroundColor))
                
                Divider()
                
                if appState.isSearching {
                    SearchingView()
                } else if appState.searchResults.isEmpty {
                    EmptyStateView()
                } else {
                    SearchResultsView()
                }
            }
            .navigationTitle("Local Document Search")
            .navigationSubtitle("\(searchEngine.statistics.totalDocuments) documents indexed")
        }
        .onChange(of: appState.focusSearch) { newValue in
            if newValue {
                searchFieldFocused = true
                appState.focusSearch = false
            }
        }
        .sheet(isPresented: $appState.showingIndexSheet) {
            IndexingView()
        }
    }
}

struct SearchBarView: View {
    @EnvironmentObject var searchEngine: SearchEngineManager
    @EnvironmentObject var appState: AppState
    @FocusState.Binding var searchFieldFocused: Bool
    
    var body: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)
            
            TextField("Search documents...", text: $appState.searchQuery)
                .textFieldStyle(.plain)
                .font(.title3)
                .focused($searchFieldFocused)
                .onSubmit {
                    performSearch()
                }
                .submitLabel(.search)
            
            if !appState.searchQuery.isEmpty {
                Button(action: {
                    appState.searchQuery = ""
                    appState.searchResults.removeAll()
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }
            
            Button("Search") {
                performSearch()
            }
            .buttonStyle(.borderedProminent)
            .disabled(appState.searchQuery.isEmpty || appState.isSearching)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(NSColor.textBackgroundColor))
        .cornerRadius(8)
    }
    
    private func performSearch() {
        guard !appState.searchQuery.isEmpty else { return }
        
        Task {
            await MainActor.run {
                appState.isSearching = true
                appState.statusMessage = "Searching..."
            }
            
            let results = await searchEngine.search(query: appState.searchQuery)
            
            await MainActor.run {
                appState.searchResults = results
                appState.isSearching = false
                appState.statusMessage = "Found \(results.count) results"
            }
        }
    }
}

struct EmptyStateView: View {
    @EnvironmentObject var appState: AppState
    
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 64))
                .foregroundColor(.secondary)
            
            Text("No Search Results")
                .font(.title)
                .fontWeight(.semibold)
            
            Text("Enter a search query to find documents")
                .foregroundColor(.secondary)
            
            if appState.searchQuery.isEmpty {
                Button("Index More Documents") {
                    appState.showingIndexSheet = true
                }
                .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(NSColor.controlBackgroundColor))
    }
}

struct SearchingView: View {
    var body: some View {
        VStack(spacing: 20) {
            ProgressView()
                .scaleEffect(1.5)
            
            Text("Searching documents...")
                .font(.headline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(NSColor.controlBackgroundColor))
    }
}

struct SearchResultsView: View {
    @EnvironmentObject var appState: AppState
    
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 1) {
                ForEach(appState.searchResults) { result in
                    SearchResultRow(result: result)
                        .background(
                            appState.selectedResult?.id == result.id ?
                            Color.accentColor.opacity(0.1) : Color.clear
                        )
                        .onTapGesture {
                            appState.selectedResult = result
                        }
                }
            }
            .padding(.vertical, 1)
        }
        .background(Color(NSColor.controlBackgroundColor))
    }
}

struct SearchResultRow: View {
    let result: SearchResult
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: iconForFileType(result.fileType))
                    .foregroundColor(.accentColor)
                
                Text(result.fileName)
                    .font(.headline)
                    .lineLimit(1)
                
                Spacer()
                
                ScoreIndicator(score: result.score)
            }
            
            Text(result.preview)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            
            HStack {
                Label(result.relativePath, systemImage: "folder")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Spacer()
                
                if let pageNumber = result.pageNumber {
                    Text("Page \(pageNumber)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .background(Color(NSColor.textBackgroundColor))
        .contentShape(Rectangle())
    }
    
    private func iconForFileType(_ type: String) -> String {
        switch type.lowercased() {
        case "pdf": return "doc.fill"
        case "docx", "doc": return "doc.text.fill"
        case "txt": return "doc.plaintext.fill"
        case "md": return "doc.text.fill"
        default: return "doc.fill"
        }
    }
}

struct ScoreIndicator: View {
    let score: Double
    
    private var scoreColor: Color {
        if score > 0.8 { return .green }
        if score > 0.6 { return .yellow }
        return .orange
    }
    
    private var scoreLevel: Int {
        if score > 0.8 { return 3 }
        if score > 0.6 { return 2 }
        return 1
    }
    
    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...3, id: \.self) { level in
                RoundedRectangle(cornerRadius: 2)
                    .fill(level <= scoreLevel ? scoreColor : Color.gray.opacity(0.3))
                    .frame(width: 4, height: 12)
            }
            
            Text(String(format: "%.1f%%", score * 100))
                .font(.caption2)
                .foregroundColor(.secondary)
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(SearchEngineManager.shared)
        .environmentObject(AppState())
        .frame(width: 1000, height: 700)
}