//
//  IndexingView.swift
//  FinderSemanticSearch
//
//  View for indexing folders
//

import SwiftUI
import UniformTypeIdentifiers

struct IndexingView: View {
    @ObservedObject var viewModel: SearchViewModel
    @Environment(\.dismiss) var dismiss
    @State private var isDragging = false
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Index Documents")
                .font(.largeTitle)
                .bold()
            
            // Show drop zone only when not indexing
            if !viewModel.isIndexing {
                // Drag and Drop Area
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [10]))
                        .foregroundColor(isDragging ? .accentColor : .secondary)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(isDragging ? Color.accentColor.opacity(0.1) : Color.clear)
                        )
                    
                    VStack(spacing: 12) {
                        Image(systemName: "folder.badge.plus")
                            .font(.system(size: 48))
                            .foregroundColor(isDragging ? .accentColor : .secondary)
                        
                        Text("Drop a folder here")
                            .font(.title2)
                        
                        Text("or")
                            .foregroundColor(.secondary)
                        
                        Button("Choose Folder") {
                            chooseFolder()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
                .frame(height: 200)
                .onDrop(of: [.fileURL], isTargeted: $isDragging) { providers in
                    handleDrop(providers: providers)
                    return true
                }
            }
            
            // Indexed Folders List
            if !viewModel.indexedFolders.isEmpty {
                Divider()
                
                VStack(alignment: .leading) {
                    Text("Indexed Folders")
                        .font(.headline)
                    
                    ScrollView {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(viewModel.indexedFolders, id: \.self) { folder in
                                HStack {
                                    Image(systemName: "folder.fill")
                                        .foregroundColor(.accentColor)
                                    Text(folder.lastPathComponent)
                                        .lineLimit(1)
                                    Spacer()
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }
                    .frame(maxHeight: 100)
                }
            }
            
            // Status and Progress
            if viewModel.isIndexing {
                VStack(spacing: 12) {
                    // Show current file being processed
                    if !viewModel.currentIndexingFile.isEmpty {
                        Text("Processing: \(viewModel.currentIndexingFile)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    
                    // Progress bar with determinate progress
                    if viewModel.indexingTotalFiles > 0 {
                        ProgressView(value: Double(viewModel.indexingCurrentFile), 
                                   total: Double(viewModel.indexingTotalFiles)) {
                            Text("Indexing: \(viewModel.indexingCurrentFile) of \(viewModel.indexingTotalFiles) files")
                        }
                        .progressViewStyle(.linear)
                    } else {
                        ProgressView("Indexing...")
                            .progressViewStyle(.linear)
                    }
                }
                .padding(.vertical, 8)
            }
            
            // Actions
            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.escape)
                
                Spacer()
                
                if let stats = viewModel.statistics, stats.totalDocuments > 0 {
                    Text("\(stats.totalDocuments) documents indexed")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(30)
        .frame(width: 500, height: 400)
    }
    
    private func chooseFolder() {
        print("IndexingView: Opening folder selection panel")
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Choose a folder to index"
        
        print("IndexingView: Showing panel...")
        let result = panel.runModal()
        print("IndexingView: Panel result: \(result == .OK ? "OK" : "Cancelled")")
        
        if result == .OK, let url = panel.url {
            print("IndexingView: Selected folder: \(url.path)")
            Task {
                print("IndexingView: Starting async task to index folder")
                await viewModel.indexFolder(url)
                print("IndexingView: Indexing task completed")
            }
        } else {
            print("IndexingView: No folder selected")
        }
    }
    
    private func handleDrop(providers: [NSItemProvider]) {
        for provider in providers {
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, error in
                guard let data = item as? Data,
                      let url = URL(dataRepresentation: data, relativeTo: nil) else { return }
                
                // Check if it's a directory
                var isDirectory: ObjCBool = false
                if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
                   isDirectory.boolValue {
                    Task { @MainActor in
                        await viewModel.indexFolder(url)
                    }
                }
            }
        }
    }
}

#Preview {
    IndexingView(viewModel: SearchViewModel())
}