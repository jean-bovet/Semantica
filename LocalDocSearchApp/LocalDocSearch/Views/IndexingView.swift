import SwiftUI
import UniformTypeIdentifiers

struct IndexingView: View {
    @EnvironmentObject var searchEngine: SearchEngineManager
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss
    
    @State private var selectedFolder: URL?
    @State private var isIndexing = false
    @State private var indexingProgress: Double = 0
    @State private var statusMessage = "Select a folder to index"
    @State private var documentsFound = 0
    @State private var showError = false
    @State private var errorMessage = ""
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 12) {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 48))
                    .foregroundColor(.accentColor)
                
                Text("Index Documents")
                    .font(.largeTitle)
                    .fontWeight(.semibold)
                
                Text("Select a folder to index its documents for searching")
                    .foregroundColor(.secondary)
            }
            .padding(.top, 30)
            .padding(.bottom, 20)
            
            Divider()
            
            // Folder Selection
            VStack(spacing: 20) {
                if let folder = selectedFolder {
                    SelectedFolderView(folder: folder) {
                        selectedFolder = nil
                    }
                } else {
                    FolderDropZone(selectedFolder: $selectedFolder)
                }
                
                // Indexing Options
                if selectedFolder != nil && !isIndexing {
                    IndexingOptionsView()
                }
                
                // Progress View
                if isIndexing {
                    IndexingProgressView(
                        progress: indexingProgress,
                        statusMessage: statusMessage,
                        documentsFound: documentsFound
                    )
                }
            }
            .padding(30)
            
            Spacer()
            
            Divider()
            
            // Action Buttons
            HStack {
                Button("Cancel") {
                    if !isIndexing {
                        dismiss()
                    }
                }
                .keyboardShortcut(.escape)
                .disabled(isIndexing)
                
                Spacer()
                
                if selectedFolder != nil && !isIndexing {
                    Button("Start Indexing") {
                        startIndexing()
                    }
                    .keyboardShortcut(.return)
                    .buttonStyle(.borderedProminent)
                }
                
                if isIndexing {
                    Button("Stop") {
                        // In real implementation, would cancel indexing
                        isIndexing = false
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding()
            .background(Color(NSColor.controlBackgroundColor))
        }
        .frame(width: 600, height: 500)
        .alert("Indexing Error", isPresented: $showError) {
            Button("OK") {
                showError = false
            }
        } message: {
            Text(errorMessage)
        }
    }
    
    private func startIndexing() {
        guard let folder = selectedFolder else { return }
        
        Task {
            await MainActor.run {
                isIndexing = true
                appState.isIndexing = true
                statusMessage = "Scanning folder..."
                documentsFound = 0
            }
            
            let success = await searchEngine.indexDirectory(at: folder) { progress in
                Task { @MainActor in
                    indexingProgress = progress
                    appState.indexProgress = progress
                    
                    // Update status message based on progress
                    if progress < 0.3 {
                        statusMessage = "Finding documents..."
                    } else if progress < 0.7 {
                        statusMessage = "Processing documents..."
                        documentsFound = Int(progress * 100) // Simulated
                    } else {
                        statusMessage = "Creating search index..."
                    }
                }
            }
            
            await MainActor.run {
                isIndexing = false
                appState.isIndexing = false
                
                if success {
                    appState.statusMessage = "Indexing completed"
                    dismiss()
                } else {
                    errorMessage = "Failed to index documents. Please try again."
                    showError = true
                }
            }
        }
    }
}

struct FolderDropZone: View {
    @Binding var selectedFolder: URL?
    @State private var isTargeted = false
    
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "folder.badge.plus")
                .font(.system(size: 64))
                .foregroundColor(isTargeted ? .accentColor : .secondary)
            
            Text("Drop a folder here")
                .font(.headline)
            
            Text("or")
                .foregroundColor(.secondary)
            
            Button("Choose Folder...") {
                selectFolder()
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 200)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(
                    style: StrokeStyle(lineWidth: 2, dash: [8])
                )
                .foregroundColor(isTargeted ? .accentColor : Color.secondary.opacity(0.5))
        )
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(isTargeted ? Color.accentColor.opacity(0.05) : Color.clear)
        )
        .onDrop(of: [.fileURL], isTargeted: $isTargeted) { providers in
            handleDrop(providers: providers)
            return true
        }
    }
    
    private func selectFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.title = "Choose Folder to Index"
        panel.message = "Select a folder containing documents to index"
        
        if panel.runModal() == .OK {
            selectedFolder = panel.url
        }
    }
    
    private func handleDrop(providers: [NSItemProvider]) {
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                    if let data = item as? Data,
                       let url = URL(dataRepresentation: data, relativeTo: nil) {
                        DispatchQueue.main.async {
                            var isDirectory: ObjCBool = false
                            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
                               isDirectory.boolValue {
                                selectedFolder = url
                            }
                        }
                    }
                }
            }
        }
    }
}

struct SelectedFolderView: View {
    let folder: URL
    let onRemove: () -> Void
    @State private var fileCount = 0
    
    var body: some View {
        HStack {
            Image(systemName: "folder.fill")
                .font(.largeTitle)
                .foregroundColor(.accentColor)
            
            VStack(alignment: .leading) {
                Text(folder.lastPathComponent)
                    .font(.headline)
                
                Text(folder.path)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                
                if fileCount > 0 {
                    Text("\(fileCount) documents found")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            
            Spacer()
            
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding()
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(8)
        .onAppear {
            countDocuments()
        }
    }
    
    private func countDocuments() {
        DispatchQueue.global().async {
            let supportedExtensions = ["pdf", "txt", "docx", "doc", "md"]
            var count = 0
            
            if let enumerator = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: nil) {
                for case let url as URL in enumerator {
                    if supportedExtensions.contains(url.pathExtension.lowercased()) {
                        count += 1
                    }
                }
            }
            
            DispatchQueue.main.async {
                fileCount = count
            }
        }
    }
}

struct IndexingOptionsView: View {
    @StateObject private var settings = SettingsManager.shared
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Indexing Options")
                .font(.headline)
            
            HStack {
                Text("Model:")
                Picker("", selection: $settings.embeddingModel) {
                    ForEach(SettingsManager.EmbeddingModel.allCases, id: \.self) { model in
                        Text(model.rawValue).tag(model)
                    }
                }
                .frame(width: 200)
            }
            
            Toggle("Use cache for faster re-indexing", isOn: $settings.useCache)
                .font(.subheadline)
        }
        .padding()
        .background(Color(NSColor.controlBackgroundColor).opacity(0.5))
        .cornerRadius(8)
    }
}

struct IndexingProgressView: View {
    let progress: Double
    let statusMessage: String
    let documentsFound: Int
    
    var body: some View {
        VStack(spacing: 16) {
            ProgressView(value: progress) {
                Text(statusMessage)
                    .font(.headline)
            } currentValueLabel: {
                Text("\(Int(progress * 100))%")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            if documentsFound > 0 {
                Label("\(documentsFound) documents processed", systemImage: "doc.text")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(NSColor.controlBackgroundColor).opacity(0.5))
        .cornerRadius(8)
    }
}