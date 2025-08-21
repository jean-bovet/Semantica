//
//  StatusBarView.swift
//  FinderSemanticSearch
//
//  Status bar component showing indexing progress and system state
//

import SwiftUI

struct StatusBarView: View {
    @ObservedObject var viewModel: SearchViewModel
    @Binding var showingFolderPicker: Bool
    
    var body: some View {
        HStack(spacing: 12) {
            // Left side: Status icon and text
            Image(systemName: statusIcon)
                .foregroundColor(statusColor)
                .imageScale(.small)
            
            Text(statusText)
                .font(.caption)
                .lineLimit(1)
            
            Divider()
                .frame(height: 12)
            
            // Document count
            if viewModel.totalDocuments > 0 && !viewModel.isIndexing {
                Text("\(viewModel.totalDocuments) docs")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                
                Divider()
                    .frame(height: 12)
            }
            
            // Index Folder menu
            if !viewModel.isIndexing {
                Menu {
                    Button("Index New Folder...") {
                        showingFolderPicker = true
                    }
                    
                    if !viewModel.indexedFolders.isEmpty {
                        Divider()
                        
                        Section("Re-index") {
                            ForEach(viewModel.indexedFolders) { folder in
                                Button(action: {
                                    Task {
                                        await viewModel.reindexFolder(folder.url)
                                    }
                                }) {
                                    HStack {
                                        Text(folder.url.lastPathComponent)
                                        Spacer()
                                        Text(folder.indexedAt, style: .relative)
                                            .font(.caption2)
                                    }
                                }
                            }
                        }
                        
                        Divider()
                        
                        Button("Clear All", role: .destructive) {
                            Task {
                                await viewModel.clearIndex()
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "folder.badge.plus")
                            .imageScale(.small)
                        Text("Index")
                            .font(.caption)
                    }
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                
                Divider()
                    .frame(height: 12)
            }
            
            // Show last indexed folder
            if let lastFolder = viewModel.lastIndexedFolder, !viewModel.isIndexing {
                Text("Last: \(lastFolder.lastPathComponent)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            
            Spacer()
            
            // Right side: Progress during indexing
            if viewModel.isIndexing {
                // Show progress during indexing
                ProgressView(value: viewModel.animatedProgress)
                    .progressViewStyle(.linear)
                    .frame(width: 150)
                
                Text("\(viewModel.currentFileIndex)/\(viewModel.totalFiles)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                
                Button("Cancel") {
                    viewModel.cancelIndexing()
                }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundColor(.red)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color(NSColor.controlBackgroundColor))
        .overlay(
            Divider(), alignment: .top
        )
    }
    
    private var statusIcon: String {
        if viewModel.isIndexing {
            return "arrow.triangle.2.circlepath"
        } else if viewModel.totalDocuments > 0 {
            return "checkmark.circle.fill"
        } else {
            return "magnifyingglass"
        }
    }
    
    private var statusColor: Color {
        if viewModel.isIndexing {
            return .blue
        } else if viewModel.totalDocuments > 0 {
            return .green
        } else {
            return .secondary
        }
    }
    
    private var statusText: String {
        if viewModel.isIndexing {
            // Show only filename, not full path
            let fileName = URL(fileURLWithPath: viewModel.currentFileName).lastPathComponent
            return "Indexing: \(fileName)"
        } else if viewModel.totalDocuments > 0 {
            return "Ready to search"
        } else {
            return "No index - Click 'Index Folder' to start"
        }
    }
}

// MARK: - Preview

struct StatusBarView_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 20) {
            // No index state
            StatusBarView(viewModel: {
                let vm = SearchViewModel()
                return vm
            }(), showingFolderPicker: .constant(false))
            
            // Indexing state
            StatusBarView(viewModel: {
                let vm = SearchViewModel()
                vm.isIndexing = true
                vm.currentFileIndex = 42
                vm.totalFiles = 100
                vm.currentFileName = "Document.pdf"
                vm.indexingProgress = 0.42
                return vm
            }(), showingFolderPicker: .constant(false))
            
            // Ready state
            StatusBarView(viewModel: {
                let vm = SearchViewModel()
                vm.totalDocuments = 156
                return vm
            }(), showingFolderPicker: .constant(false))
        }
        .frame(width: 800)
    }
}