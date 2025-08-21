//
//  PythonCLIBridge.swift
//  FinderSemanticSearch
//
//  Bridge to communicate with Python CLI search engine via JSON
//

import Foundation
import Combine

// MARK: - Data Models

struct SearchResult: Codable, Identifiable {
    let id = UUID()
    let filePath: String
    let fileName: String
    let score: Double
    let preview: String
    let pageNumber: Int?
    
    enum CodingKeys: String, CodingKey {
        case filePath = "file_path"
        case fileName = "file_name"
        case score
        case preview
        case pageNumber = "page_number"
    }
}

struct IndexStatistics: Codable {
    let totalDocuments: Int
    let totalChunks: Int
    let indexSize: Int
    let embeddingDimension: Int
    let createdAt: String?
    let lastUpdated: String?
    
    enum CodingKeys: String, CodingKey {
        case totalDocuments = "total_documents"
        case totalChunks = "total_chunks"
        case indexSize = "index_size"
        case embeddingDimension = "embedding_dimension"
        case createdAt = "created_at"
        case lastUpdated = "last_updated"
    }
}

struct IndexedFolder: Identifiable, Codable {
    let id: UUID
    let url: URL
    let indexedAt: Date
    
    init(url: URL, indexedAt: Date = Date()) {
        self.id = UUID()
        self.url = url
        self.indexedAt = indexedAt
    }
}

struct CLIResponse: Codable {
    let success: Bool
    let action: String?
    let error: String?
    let results: [SearchResult]?
    let stats: IndexStatistics?
    let totalDocuments: Int?
    let totalChunks: Int?
    let message: String?
    
    enum CodingKeys: String, CodingKey {
        case success, action, error, results, stats, message
        case totalDocuments = "total_documents"
        case totalChunks = "total_chunks"
    }
}

// MARK: - Bridge Class

@MainActor
class PythonCLIBridge: ObservableObject {
    @Published var isRunning = false
    @Published var lastError: String?
    
    private var process: Process?
    private var inputPipe: Pipe?
    private var outputPipe: Pipe?
    private var errorPipe: Pipe?
    
    private let queue = DispatchQueue(label: "com.findersemanticearch.pythonbridge", qos: .userInitiated)
    
    // Track all active processes for cleanup
    private static var activeProcesses: [Process] = []
    static let shared = PythonCLIBridge()  // Shared instance for AppDelegate
    
    init() {}
    
    // MARK: - Lifecycle
    
    func start() async throws {
        guard !isRunning else { return }
        
        // Setup process
        process = Process()
        
        // Look for standalone CLI script
        guard let standaloneCliPath = Bundle.main.path(forResource: "python_cli/cli_standalone.py", ofType: nil) else {
            throw BridgeError.cliNotFound  
        }
        
        // Use system Python 3 with standalone CLI that auto-installs dependencies
        process?.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        // The CLI is now async by default - no special arguments needed
        process?.arguments = [standaloneCliPath]
        process?.currentDirectoryURL = URL(fileURLWithPath: standaloneCliPath).deletingLastPathComponent()
        
        // Setup pipes
        inputPipe = Pipe()
        outputPipe = Pipe()
        errorPipe = Pipe()
        
        process?.standardInput = inputPipe
        process?.standardOutput = outputPipe
        process?.standardError = errorPipe
        
        // Start process
        do {
            try process?.run()
            isRunning = true
            
            // Track this process for cleanup
            if let process = process {
                PythonCLIBridge.activeProcesses.append(process)
            }
            
            print("Python process started successfully")
            print("CLI path: \(standaloneCliPath)")
            
            // Monitor for unexpected termination
            process?.terminationHandler = { [weak self] proc in
                DispatchQueue.main.async {
                    self?.isRunning = false
                    self?.lastError = "Python process terminated unexpectedly"
                    print("Python process terminated")
                    
                    // Remove from active processes
                    PythonCLIBridge.activeProcesses.removeAll { $0 == proc }
                }
            }
            
            // Monitor stderr for errors
            if let errorPipe = errorPipe {
                errorPipe.fileHandleForReading.readabilityHandler = { handle in
                    let data = handle.availableData
                    if !data.isEmpty, let error = String(data: data, encoding: .utf8) {
                        // Filter out common PDF warnings that are not actual errors
                        let trimmed = error.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !trimmed.isEmpty && 
                           !trimmed.contains("FloatObject") &&  // PDF warning
                           !trimmed.contains("invalid; use") {  // PDF warning continuation
                            print("Python stderr: \(error)")
                        }
                    }
                }
            }
            
        } catch {
            isRunning = false
            print("Failed to start Python process: \(error)")
            throw BridgeError.failedToStart(error.localizedDescription)
        }
    }
    
    func stop() {
        if isRunning {
            // Send exit command
            sendCommand(["action": "exit"])
            
            // Give it a moment to exit gracefully
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                if let process = self?.process {
                    process.terminate()
                    // Remove from active processes
                    PythonCLIBridge.activeProcesses.removeAll { $0 == process }
                }
                self?.process = nil
                self?.isRunning = false
            }
        }
    }
    
    // Force stop all Python processes immediately (for app termination)
    static func forceStop() {
        for process in activeProcesses {
            if process.isRunning {
                process.terminate()
            }
        }
        activeProcesses.removeAll()
    }
    
    // MARK: - Commands
    
    func search(_ query: String, limit: Int = 10) async throws -> [SearchResult] {
        let command = [
            "action": "search",
            "query": query,
            "limit": limit
        ] as [String: Any]
        
        let response = try await sendCommandAndWait(command)
        
        if response.success, let results = response.results {
            return results
        } else {
            throw BridgeError.commandFailed(response.error ?? "Search failed")
        }
    }
    
    func indexFolder(_ url: URL, progressHandler: ((Int, Int, String) -> Void)? = nil) async throws -> (documents: Int, chunks: Int) {
        guard isRunning else {
            throw BridgeError.notRunning
        }
        
        let command = [
            "action": "index",
            "folder": url.path
        ] as [String: Any]
        
        let response: CLIResponse
        if let progressHandler = progressHandler {
            response = try await sendCommandAndWaitWithProgress(command, progressHandler: progressHandler)
        } else {
            response = try await sendCommandAndWait(command)
        }
        
        if response.success {
            let docs = response.totalDocuments ?? 0
            let chunks = response.totalChunks ?? 0
            return (docs, chunks)
        } else {
            throw BridgeError.commandFailed(response.error ?? "Indexing failed")
        }
    }
    
    func getStatistics() async throws -> IndexStatistics {
        let command = ["action": "stats"]
        
        let response = try await sendCommandAndWait(command)
        
        if response.success, let stats = response.stats {
            return stats
        } else {
            throw BridgeError.commandFailed(response.error ?? "Failed to get statistics")
        }
    }
    
    func clearIndex() async throws {
        let command = ["action": "clear"]
        
        let response = try await sendCommandAndWait(command)
        
        if !response.success {
            throw BridgeError.commandFailed(response.error ?? "Failed to clear index")
        }
    }
    
    // MARK: - Private Methods
    
    private func sendCommand(_ command: [String: Any]) {
        guard isRunning, let inputPipe = inputPipe else { return }
        
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: command)
            inputPipe.fileHandleForWriting.write(jsonData)
            inputPipe.fileHandleForWriting.write("\n".data(using: .utf8)!)
        } catch {
            print("Failed to send command: \(error)")
        }
    }
    
    private func sendCommandAndWait(_ command: [String: Any]) async throws -> CLIResponse {
        guard isRunning else {
            throw BridgeError.notRunning
        }
        
        // Capture pipes before entering the async context
        let inputPipe = self.inputPipe
        let outputPipe = self.outputPipe
        let expectedAction = command["action"] as? String  // Get the action we're expecting
        
        return try await withCheckedThrowingContinuation { continuation in
            queue.async {
                guard let inputPipe = inputPipe, let outputPipe = outputPipe else {
                    continuation.resume(throwing: BridgeError.notRunning)
                    return
                }
                
                // Send command
                do {
                    let jsonData = try JSONSerialization.data(withJSONObject: command)
                    inputPipe.fileHandleForWriting.write(jsonData)
                    inputPipe.fileHandleForWriting.write("\n".data(using: .utf8)!)
                    
                    // Read until we get a complete response
                    var responseData = Data()
                    let fileHandle = outputPipe.fileHandleForReading
                    var statusMessages: [String] = []
                    
                    while true {
                        let chunk = fileHandle.availableData
                        if chunk.isEmpty {
                            Thread.sleep(forTimeInterval: 0.01)
                            continue
                        }
                        
                        responseData.append(chunk)
                        
                        // Check if we have complete JSON objects
                        if let string = String(data: responseData, encoding: .utf8),
                           string.contains("\n") {
                            // Parse each line as a potential JSON object
                            let lines = string.components(separatedBy: "\n").filter { !$0.isEmpty }
                            
                            for line in lines {
                                if let lineData = line.data(using: .utf8) {
                                    do {
                                        // Try to decode as a full response with matching action
                                        let response = try JSONDecoder().decode(CLIResponse.self, from: lineData)
                                        if response.action == expectedAction {  // Only accept responses with matching action
                                            continuation.resume(returning: response)
                                            return
                                        }
                                    } catch {
                                        // This might be a status message, try to parse it
                                        if let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                                           json["status"] != nil {
                                            // It's a status message, store it and continue
                                            statusMessages.append(line)
                                        } else {
                                            // Not a status message and not a valid response
                                        }
                                    }
                                }
                            }
                        }
                        
                        // Timeout after 10 seconds
                        if responseData.count > 1_000_000 { // 1MB limit
                            continuation.resume(throwing: BridgeError.timeout)
                            return
                        }
                    }
                    
                } catch {
                    continuation.resume(throwing: BridgeError.commandFailed(error.localizedDescription))
                }
            }
        }
    }
    
    private func sendCommandAndWaitWithProgress(_ command: [String: Any], progressHandler: ((Int, Int, String) -> Void)?) async throws -> CLIResponse {
        guard isRunning else {
            throw BridgeError.notRunning
        }
        
        let inputPipe = self.inputPipe
        let outputPipe = self.outputPipe
        let expectedAction = command["action"] as? String  // Get the action we're expecting
        
        return try await withCheckedThrowingContinuation { continuation in
            queue.async {
                guard let inputPipe = inputPipe, let outputPipe = outputPipe else {
                    continuation.resume(throwing: BridgeError.notRunning)
                    return
                }
                
                do {
                    let jsonData = try JSONSerialization.data(withJSONObject: command)
                    inputPipe.fileHandleForWriting.write(jsonData)
                    inputPipe.fileHandleForWriting.write("\n".data(using: .utf8)!)
                    
                    var buffer = Data()
                    let fileHandle = outputPipe.fileHandleForReading
                    var hasResumed = false
                    
                    while !hasResumed {
                        let chunk = fileHandle.availableData
                        if chunk.isEmpty {
                            Thread.sleep(forTimeInterval: 0.01)
                            continue
                        }
                        
                        buffer.append(chunk)
                        
                        // Try to parse complete JSON objects from buffer
                        if let string = String(data: buffer, encoding: .utf8) {
                            // Split by newlines to get individual JSON objects
                            let lines = string.components(separatedBy: "\n")
                            
                            // Keep the last incomplete line in buffer
                            if lines.count > 1 {
                                // Process all complete lines
                                for i in 0..<(lines.count - 1) {
                                    let line = lines[i]
                                    if line.isEmpty { continue }
                                    
                                    if let lineData = line.data(using: .utf8) {
                                        // First try to decode as CLIResponse with matching action
                                        if let response = try? JSONDecoder().decode(CLIResponse.self, from: lineData),
                                           response.action == expectedAction {  // Only accept responses with matching action
                                            continuation.resume(returning: response)
                                            hasResumed = true
                                            return
                                        }
                                        
                                        // Otherwise, try to parse as status message
                                        if let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                                           let status = json["status"] as? String {
                                            
                                            // Handle different status types
                                            switch status {
                                            case "processing_file":
                                                if let current = json["current"] as? Int,
                                                   let total = json["total"] as? Int,
                                                   let file = json["file"] as? String {
                                                    DispatchQueue.main.async {
                                                        progressHandler?(current, total, file)
                                                    }
                                                }
                                            case "generating_embeddings":
                                                if let current = json["current"] as? Int,
                                                   let total = json["total"] as? Int,
                                                   let file = json["file"] as? String {
                                                    DispatchQueue.main.async {
                                                        progressHandler?(current, total, "Generating embeddings: \(file)")
                                                    }
                                                }
                                            case "documents_found":
                                                // Don't call progress handler here - wait for actual processing_file updates
                                                // The total will be set when the first processing_file status arrives
                                                break
                                            default:
                                                break
                                            }
                                        }
                                    }
                                }
                                
                                // Keep the last (possibly incomplete) line
                                if let lastLine = lines.last,
                                   let lastLineData = lastLine.data(using: .utf8) {
                                    buffer = lastLineData
                                } else {
                                    buffer = Data()
                                }
                            }
                        }
                        
                        // Timeout check
                        if buffer.count > 1_000_000 {
                            continuation.resume(throwing: BridgeError.timeout)
                            return
                        }
                    }
                } catch {
                    continuation.resume(throwing: BridgeError.commandFailed(error.localizedDescription))
                }
            }
        }
    }
    
    deinit {
        // Stop will be called from ViewModel
    }
}

// MARK: - Errors

enum BridgeError: LocalizedError {
    case cliNotFound
    case notRunning
    case failedToStart(String)
    case commandFailed(String)
    case invalidResponse(String)
    case timeout
    
    var errorDescription: String? {
        switch self {
        case .cliNotFound:
            return "Python CLI not found in app bundle"
        case .notRunning:
            return "Python process is not running"
        case .failedToStart(let error):
            return "Failed to start Python process: \(error)"
        case .commandFailed(let error):
            return "Command failed: \(error)"
        case .invalidResponse(let error):
            return "Invalid response from Python: \(error)"
        case .timeout:
            return "Command timed out"
        }
    }
}