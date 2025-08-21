//
//  StatusBarView.swift
//  FinderSemanticSearch
//
//  Status bar component showing indexing progress and system state
//

import SwiftUI

struct StatusBarView: View {
    @ObservedObject var viewModel: SearchViewModel
    
    var body: some View {
        HStack(spacing: 12) {
            // Left side: Status icon and text
            Image(systemName: statusIcon)
                .foregroundColor(statusColor)
                .imageScale(.small)
            
            Text(statusText)
                .font(.caption)
                .lineLimit(1)
            
            Spacer()
            
            // Right side: Progress or stats
            if viewModel.isIndexing {
                // Show progress during indexing
                ProgressView(value: viewModel.indexingProgress)
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
            } else if viewModel.totalDocuments > 0 {
                // Show document count when idle
                Text("\(viewModel.totalDocuments) documents")
                    .font(.caption2)
                    .foregroundColor(.secondary)
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
            }())
            
            // Indexing state
            StatusBarView(viewModel: {
                let vm = SearchViewModel()
                vm.isIndexing = true
                vm.currentFileIndex = 42
                vm.totalFiles = 100
                vm.currentFileName = "Document.pdf"
                vm.indexingProgress = 0.42
                return vm
            }())
            
            // Ready state
            StatusBarView(viewModel: {
                let vm = SearchViewModel()
                vm.totalDocuments = 156
                return vm
            }())
        }
        .frame(width: 800)
    }
}