import SwiftUI

struct SidebarView: View {
    @EnvironmentObject var searchEngine: SearchEngineManager
    @EnvironmentObject var appState: AppState
    @State private var selectedSection = "recent"
    
    var body: some View {
        List(selection: $selectedSection) {
            Section("Search") {
                Label("Recent Searches", systemImage: "clock.arrow.circlepath")
                    .tag("recent")
                
                Label("Saved Searches", systemImage: "star")
                    .tag("saved")
                    .badge(3)
            }
            
            Section("Documents") {
                Label("All Documents", systemImage: "doc.text")
                    .tag("all")
                    .badge(searchEngine.statistics.totalDocuments)
                
                Label("Recently Indexed", systemImage: "clock")
                    .tag("recent-docs")
                
                Label("By Type", systemImage: "doc.on.doc")
                    .tag("by-type")
            }
            
            Section("Folders") {
                ForEach(searchEngine.indexedFolders, id: \.self) { folder in
                    Label {
                        Text(folder.lastPathComponent)
                    } icon: {
                        Image(systemName: "folder.fill")
                            .foregroundColor(.accentColor)
                    }
                    .tag("folder-\(folder.path)")
                }
                
                Button(action: {
                    appState.showingIndexSheet = true
                }) {
                    Label("Add Folder...", systemImage: "plus.circle")
                }
                .buttonStyle(.plain)
                .foregroundColor(.accentColor)
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Library")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: {
                    appState.showingIndexSheet = true
                }) {
                    Label("Index", systemImage: "plus")
                }
            }
            
            ToolbarItem(placement: .automatic) {
                Button(action: {
                    searchEngine.refreshStatistics()
                }) {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            IndexStatusBar()
                .padding(.horizontal)
                .padding(.vertical, 8)
        }
    }
}

struct IndexStatusBar: View {
    @EnvironmentObject var searchEngine: SearchEngineManager
    @EnvironmentObject var appState: AppState
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if appState.isIndexing {
                HStack {
                    ProgressView()
                        .scaleEffect(0.7)
                    
                    Text("Indexing...")
                        .font(.caption)
                    
                    Spacer()
                    
                    Text("\(Int(appState.indexProgress * 100))%")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                ProgressView(value: appState.indexProgress)
                    .progressViewStyle(.linear)
            } else {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                        .imageScale(.small)
                    
                    Text(appState.statusMessage)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    Spacer()
                }
            }
            
            HStack(spacing: 12) {
                Label("\(searchEngine.statistics.totalDocuments)", systemImage: "doc.text")
                
                Divider()
                    .frame(height: 10)
                
                Label("\(searchEngine.statistics.totalChunks)", systemImage: "square.stack.3d.up")
                
                Divider()
                    .frame(height: 10)
                
                Label(formatBytes(searchEngine.statistics.indexSize), systemImage: "internaldrive")
            }
            .font(.caption2)
            .foregroundColor(.secondary)
        }
        .padding(8)
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(6)
    }
    
    private func formatBytes(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
}