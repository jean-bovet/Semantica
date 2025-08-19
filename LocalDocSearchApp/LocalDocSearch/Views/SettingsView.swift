import SwiftUI

struct SettingsView: View {
    @StateObject private var settings = SettingsManager.shared
    @EnvironmentObject var searchEngine: SearchEngineManager
    
    var body: some View {
        TabView {
            GeneralSettingsView()
                .tabItem {
                    Label("General", systemImage: "gear")
                }
            
            SearchSettingsView()
                .tabItem {
                    Label("Search", systemImage: "magnifyingglass")
                }
            
            IndexingSettingsView()
                .tabItem {
                    Label("Indexing", systemImage: "doc.text.magnifyingglass")
                }
            
            AdvancedSettingsView()
                .tabItem {
                    Label("Advanced", systemImage: "wrench.and.screwdriver")
                }
        }
        .frame(width: 600, height: 400)
    }
}

struct GeneralSettingsView: View {
    @AppStorage("appearanceMode") private var appearanceMode = "system"
    @AppStorage("showStatusBar") private var showStatusBar = true
    @AppStorage("autoIndex") private var autoIndex = false
    
    var body: some View {
        Form {
            Section {
                Picker("Appearance:", selection: $appearanceMode) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                .pickerStyle(.segmented)
                
                Toggle("Show status bar", isOn: $showStatusBar)
                Toggle("Automatically index new folders", isOn: $autoIndex)
            }
            
            Section("Startup") {
                Toggle("Launch at login", isOn: .constant(false))
                    .disabled(true)
                
                Toggle("Check for updates automatically", isOn: .constant(true))
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

struct SearchSettingsView: View {
    @StateObject private var settings = SettingsManager.shared
    
    var body: some View {
        Form {
            Section("Search Results") {
                HStack {
                    Text("Maximum results:")
                    Stepper(value: $settings.searchResultsLimit, in: 5...100, step: 5) {
                        Text("\(settings.searchResultsLimit)")
                            .frame(width: 50, alignment: .trailing)
                    }
                }
                
                Toggle("Highlight search terms", isOn: .constant(true))
                Toggle("Sort by relevance", isOn: .constant(true))
                Toggle("Group by document", isOn: .constant(false))
            }
            
            Section("Search Behavior") {
                Toggle("Search as you type", isOn: .constant(false))
                Toggle("Include file names in search", isOn: .constant(true))
                Toggle("Case sensitive search", isOn: .constant(false))
            }
        }
        .formStyle(.grouped)
        .padding()
        .onChange(of: settings.searchResultsLimit) { _ in
            settings.saveSettings()
        }
    }
}

struct IndexingSettingsView: View {
    @StateObject private var settings = SettingsManager.shared
    
    var body: some View {
        Form {
            Section("Embedding Model") {
                Picker("Model type:", selection: $settings.embeddingModel) {
                    ForEach(SettingsManager.EmbeddingModel.allCases, id: \.self) { model in
                        Text(model.rawValue).tag(model)
                    }
                }
                .pickerStyle(.radioGroup)
                
                if settings.embeddingModel == .ollama {
                    HStack {
                        Text("Ollama model:")
                        TextField("nomic-embed-text", text: .constant("nomic-embed-text"))
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }
            
            Section("Document Processing") {
                HStack {
                    Text("Chunk size:")
                    Stepper(value: $settings.chunkSize, in: 500...2000, step: 100) {
                        Text("\(settings.chunkSize) words")
                            .frame(width: 100, alignment: .trailing)
                    }
                }
                
                HStack {
                    Text("Chunk overlap:")
                    Stepper(value: $settings.chunkOverlap, in: 50...500, step: 50) {
                        Text("\(settings.chunkOverlap) words")
                            .frame(width: 100, alignment: .trailing)
                    }
                }
                
                Toggle("Use embedding cache", isOn: $settings.useCache)
                    .help("Cache embeddings to speed up re-indexing")
            }
            
            Section("File Types") {
                Text("Supported formats:")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                
                VStack(alignment: .leading, spacing: 4) {
                    Label("PDF Documents (.pdf)", systemImage: "checkmark.circle.fill")
                    Label("Word Documents (.docx, .doc)", systemImage: "checkmark.circle.fill")
                    Label("Text Files (.txt)", systemImage: "checkmark.circle.fill")
                    Label("Markdown Files (.md)", systemImage: "checkmark.circle.fill")
                }
                .font(.caption)
                .foregroundColor(.green)
            }
        }
        .formStyle(.grouped)
        .padding()
        .onChange(of: settings.embeddingModel) { _ in
            settings.saveSettings()
        }
        .onChange(of: settings.chunkSize) { _ in
            settings.saveSettings()
        }
        .onChange(of: settings.chunkOverlap) { _ in
            settings.saveSettings()
        }
        .onChange(of: settings.useCache) { _ in
            settings.saveSettings()
        }
    }
}

struct AdvancedSettingsView: View {
    @EnvironmentObject var searchEngine: SearchEngineManager
    @State private var showingClearConfirmation = false
    @State private var showingResetConfirmation = false
    
    var body: some View {
        Form {
            Section("Index Management") {
                HStack {
                    VStack(alignment: .leading) {
                        Text("Current index size:")
                        Text(formatBytes(searchEngine.statistics.indexSize))
                            .font(.title2)
                            .fontWeight(.semibold)
                    }
                    
                    Spacer()
                    
                    Button("Clear Index") {
                        showingClearConfirmation = true
                    }
                    .buttonStyle(.bordered)
                }
                
                HStack {
                    Text("Total documents:")
                    Spacer()
                    Text("\(searchEngine.statistics.totalDocuments)")
                        .foregroundColor(.secondary)
                }
                
                HStack {
                    Text("Total chunks:")
                    Spacer()
                    Text("\(searchEngine.statistics.totalChunks)")
                        .foregroundColor(.secondary)
                }
                
                HStack {
                    Text("Embedding dimension:")
                    Spacer()
                    Text("\(searchEngine.statistics.embeddingDimension)")
                        .foregroundColor(.secondary)
                }
            }
            
            Section("Python Environment") {
                HStack {
                    Text("Python version:")
                    Spacer()
                    Text("3.11.0")
                        .foregroundColor(.secondary)
                }
                
                HStack {
                    Text("FAISS version:")
                    Spacer()
                    Text("1.7.4")
                        .foregroundColor(.secondary)
                }
                
                HStack {
                    Text("Status:")
                    Spacer()
                    if searchEngine.isInitialized {
                        Label("Connected", systemImage: "checkmark.circle.fill")
                            .foregroundColor(.green)
                    } else {
                        Label("Not initialized", systemImage: "xmark.circle.fill")
                            .foregroundColor(.red)
                    }
                }
            }
            
            Section("Reset") {
                Button("Reset All Settings") {
                    showingResetConfirmation = true
                }
                .buttonStyle(.bordered)
                .foregroundColor(.red)
            }
        }
        .formStyle(.grouped)
        .padding()
        .confirmationDialog("Clear Index", isPresented: $showingClearConfirmation) {
            Button("Clear Index", role: .destructive) {
                searchEngine.clearIndex()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will remove all indexed documents. You'll need to re-index your folders.")
        }
        .confirmationDialog("Reset Settings", isPresented: $showingResetConfirmation) {
            Button("Reset All Settings", role: .destructive) {
                resetAllSettings()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will reset all settings to their default values.")
        }
    }
    
    private func formatBytes(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
    
    private func resetAllSettings() {
        UserDefaults.standard.removePersistentDomain(forName: Bundle.main.bundleIdentifier!)
        UserDefaults.standard.synchronize()
    }
}