import Foundation
import PythonKit

// MARK: - Python Bridge Manager
class PythonBridge {
    static let shared = PythonBridge()
    
    private var searchEngine: PythonObject?
    private let pythonQueue = DispatchQueue(label: "com.localdocsearch.python", qos: .userInitiated)
    private var isInitialized = false
    
    private init() {}
    
    func initialize() async throws {
        try await withCheckedThrowingContinuation { continuation in
            pythonQueue.async { [weak self] in
                guard let self = self else {
                    continuation.resume(throwing: PythonBridgeError.initializationFailed)
                    return
                }
                
                do {
                    // Set Python path to bundled Python or system Python
                    self.setupPythonEnvironment()
                    
                    // Import the search module
                    let sys = Python.import("sys")
                    let searchPath = Bundle.main.path(forResource: "python_src", ofType: nil) ?? ""
                    sys.path.append(searchPath)
                    
                    // Import our search engine
                    let searchModule = try Python.attemptImport("search")
                    self.searchEngine = searchModule.DocumentSearchEngine()
                    
                    self.isInitialized = true
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: PythonBridgeError.moduleImportFailed(error.localizedDescription))
                }
            }
        }
    }
    
    func search(query: String) async throws -> [SearchResult] {
        guard isInitialized else {
            throw PythonBridgeError.notInitialized
        }
        
        return try await withCheckedThrowingContinuation { continuation in
            pythonQueue.async { [weak self] in
                guard let self = self, let engine = self.searchEngine else {
                    continuation.resume(throwing: PythonBridgeError.engineNotAvailable)
                    return
                }
                
                do {
                    // Call Python search method
                    let pythonResults = engine.search(query, k: 20, display_results: false)
                    
                    // Convert Python results to Swift
                    var swiftResults: [SearchResult] = []
                    
                    for result in pythonResults {
                        let chunk = result[0]
                        let score = Double(result[1]) ?? 0.0
                        
                        let searchResult = SearchResult(
                            id: UUID().uuidString,
                            fileName: String(chunk.metadata["file_name"]) ?? "Unknown",
                            filePath: String(chunk.metadata["file_path"]) ?? "",
                            preview: String(chunk.content) ?? "",
                            score: score,
                            pageNumber: Python.int(chunk.metadata["page_number"]).map { Int($0) },
                            fileType: self.extractFileType(from: String(chunk.metadata["file_name"]) ?? "")
                        )
                        
                        swiftResults.append(searchResult)
                    }
                    
                    continuation.resume(returning: swiftResults)
                } catch {
                    continuation.resume(throwing: PythonBridgeError.searchFailed(error.localizedDescription))
                }
            }
        }
    }
    
    func indexDirectory(at url: URL) async throws -> IndexingResult {
        guard isInitialized else {
            throw PythonBridgeError.notInitialized
        }
        
        return try await withCheckedThrowingContinuation { continuation in
            pythonQueue.async { [weak self] in
                guard let self = self, let engine = self.searchEngine else {
                    continuation.resume(throwing: PythonBridgeError.engineNotAvailable)
                    return
                }
                
                do {
                    // Call Python indexing method
                    engine.index_directory(url.path)
                    
                    // Get statistics
                    let stats = engine.indexer.get_statistics()
                    
                    let result = IndexingResult(
                        documentsProcessed: Int(stats["total_documents"]) ?? 0,
                        chunksCreated: Int(stats["total_chunks"]) ?? 0,
                        success: true,
                        error: nil
                    )
                    
                    continuation.resume(returning: result)
                } catch {
                    let result = IndexingResult(
                        documentsProcessed: 0,
                        chunksCreated: 0,
                        success: false,
                        error: error.localizedDescription
                    )
                    continuation.resume(returning: result)
                }
            }
        }
    }
    
    func getStatistics() async throws -> IndexStatistics {
        guard isInitialized else {
            throw PythonBridgeError.notInitialized
        }
        
        return try await withCheckedThrowingContinuation { continuation in
            pythonQueue.async { [weak self] in
                guard let self = self, let engine = self.searchEngine else {
                    continuation.resume(throwing: PythonBridgeError.engineNotAvailable)
                    return
                }
                
                do {
                    let stats = engine.indexer.get_statistics()
                    
                    let statistics = IndexStatistics(
                        totalDocuments: Int(stats["total_documents"]) ?? 0,
                        totalChunks: Int(stats["total_chunks"]) ?? 0,
                        indexSize: Int64(stats["index_size"]) ?? 0,
                        embeddingDimension: Int(stats["embedding_dimension"]) ?? 0,
                        lastUpdated: String(stats["last_updated"]) ?? ""
                    )
                    
                    continuation.resume(returning: statistics)
                } catch {
                    continuation.resume(throwing: PythonBridgeError.statisticsFailed(error.localizedDescription))
                }
            }
        }
    }
    
    func clearIndex() async throws {
        guard isInitialized else {
            throw PythonBridgeError.notInitialized
        }
        
        return try await withCheckedThrowingContinuation { continuation in
            pythonQueue.async { [weak self] in
                guard let self = self, let engine = self.searchEngine else {
                    continuation.resume(throwing: PythonBridgeError.engineNotAvailable)
                    return
                }
                
                do {
                    engine.clear_index()
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: PythonBridgeError.clearIndexFailed(error.localizedDescription))
                }
            }
        }
    }
    
    // MARK: - Private Methods
    
    private func setupPythonEnvironment() {
        // Set Python home to bundled Python framework
        if let pythonPath = Bundle.main.privateFrameworksPath?.appending("/Python.framework/Versions/3.11") {
            setenv("PYTHONHOME", pythonPath, 1)
            setenv("PYTHONPATH", "\(pythonPath)/lib/python3.11:\(pythonPath)/lib/python3.11/site-packages", 1)
        }
    }
    
    private func extractFileType(from fileName: String) -> String {
        let url = URL(fileURLWithPath: fileName)
        return url.pathExtension.uppercased()
    }
}

// MARK: - Error Types

enum PythonBridgeError: LocalizedError {
    case initializationFailed
    case moduleImportFailed(String)
    case notInitialized
    case engineNotAvailable
    case searchFailed(String)
    case indexingFailed(String)
    case statisticsFailed(String)
    case clearIndexFailed(String)
    
    var errorDescription: String? {
        switch self {
        case .initializationFailed:
            return "Failed to initialize Python bridge"
        case .moduleImportFailed(let details):
            return "Failed to import Python module: \(details)"
        case .notInitialized:
            return "Python bridge is not initialized"
        case .engineNotAvailable:
            return "Search engine is not available"
        case .searchFailed(let details):
            return "Search failed: \(details)"
        case .indexingFailed(let details):
            return "Indexing failed: \(details)"
        case .statisticsFailed(let details):
            return "Failed to get statistics: \(details)"
        case .clearIndexFailed(let details):
            return "Failed to clear index: \(details)"
        }
    }
}

// MARK: - Result Types

struct IndexingResult {
    let documentsProcessed: Int
    let chunksCreated: Int
    let success: Bool
    let error: String?
}

struct IndexStatistics {
    let totalDocuments: Int
    let totalChunks: Int
    let indexSize: Int64
    let embeddingDimension: Int
    let lastUpdated: String
}