import Foundation

// MARK: - Search Result Model
struct SearchResult: Identifiable, Equatable {
    let id: String
    let fileName: String
    let filePath: String
    let preview: String
    let score: Double
    let pageNumber: Int?
    let fileType: String
    
    var relativePath: String {
        let url = URL(fileURLWithPath: filePath)
        let components = url.pathComponents
        if components.count > 3 {
            return "..." + components.suffix(3).joined(separator: "/")
        }
        return url.lastPathComponent
    }
}

// MARK: - Search Engine Manager
@MainActor
class SearchEngineManager: ObservableObject {
    static let shared = SearchEngineManager()
    
    @Published var statistics = IndexStatistics(
        totalDocuments: 0,
        totalChunks: 0,
        indexSize: 0,
        embeddingDimension: 384,
        lastUpdated: ""
    )
    
    @Published var indexedFolders: [URL] = []
    @Published var isInitialized = false
    @Published var initializationError: String?
    
    private let pythonBridge = PythonBridge.shared
    private let userDefaults = UserDefaults.standard
    
    private init() {
        loadIndexedFolders()
    }
    
    // MARK: - Public Methods
    
    func initialize() async {
        do {
            try await pythonBridge.initialize()
            await refreshStatistics()
            isInitialized = true
            initializationError = nil
        } catch {
            initializationError = error.localizedDescription
            print("Failed to initialize search engine: \(error)")
        }
    }
    
    func search(query: String) async -> [SearchResult] {
        guard isInitialized else {
            print("Search engine not initialized")
            return []
        }
        
        do {
            let results = try await pythonBridge.search(query: query)
            return results
        } catch {
            print("Search failed: \(error)")
            return []
        }
    }
    
    func indexDirectory(at url: URL, progressHandler: @escaping (Double) -> Void) async -> Bool {
        guard isInitialized else {
            print("Search engine not initialized")
            return false
        }
        
        do {
            // Start progress updates
            let progressTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
                // In real implementation, get actual progress from Python
                let simulatedProgress = Double.random(in: 0.1...0.9)
                progressHandler(simulatedProgress)
            }
            
            let result = try await pythonBridge.indexDirectory(at: url)
            
            progressTimer.invalidate()
            progressHandler(1.0)
            
            if result.success {
                addIndexedFolder(url)
                await refreshStatistics()
            }
            
            return result.success
        } catch {
            print("Indexing failed: \(error)")
            return false
        }
    }
    
    func clearIndex() {
        Task {
            do {
                try await pythonBridge.clearIndex()
                await refreshStatistics()
                clearIndexedFolders()
            } catch {
                print("Failed to clear index: \(error)")
            }
        }
    }
    
    func refreshStatistics() {
        Task {
            do {
                statistics = try await pythonBridge.getStatistics()
            } catch {
                print("Failed to refresh statistics: \(error)")
            }
        }
    }
    
    // MARK: - Private Methods
    
    private func loadIndexedFolders() {
        if let data = userDefaults.data(forKey: "IndexedFolders"),
           let urls = try? JSONDecoder().decode([URL].self, from: data) {
            indexedFolders = urls
        }
    }
    
    private func saveIndexedFolders() {
        if let data = try? JSONEncoder().encode(indexedFolders) {
            userDefaults.set(data, forKey: "IndexedFolders")
        }
    }
    
    private func addIndexedFolder(_ url: URL) {
        if !indexedFolders.contains(url) {
            indexedFolders.append(url)
            saveIndexedFolders()
        }
    }
    
    private func clearIndexedFolders() {
        indexedFolders.removeAll()
        saveIndexedFolders()
    }
}

// MARK: - Settings Manager
class SettingsManager: ObservableObject {
    static let shared = SettingsManager()
    
    @Published var embeddingModel: EmbeddingModel = .sentenceTransformer
    @Published var chunkSize: Int = 1000
    @Published var chunkOverlap: Int = 200
    @Published var searchResultsLimit: Int = 20
    @Published var useCache: Bool = true
    @Published var modelPath: String = ""
    
    private let userDefaults = UserDefaults.standard
    
    enum EmbeddingModel: String, CaseIterable {
        case sentenceTransformer = "Sentence Transformer"
        case ollama = "Ollama"
        
        var pythonValue: String {
            switch self {
            case .sentenceTransformer: return "sentence-transformer"
            case .ollama: return "ollama"
            }
        }
    }
    
    private init() {
        loadSettings()
    }
    
    func saveSettings() {
        userDefaults.set(embeddingModel.rawValue, forKey: "EmbeddingModel")
        userDefaults.set(chunkSize, forKey: "ChunkSize")
        userDefaults.set(chunkOverlap, forKey: "ChunkOverlap")
        userDefaults.set(searchResultsLimit, forKey: "SearchResultsLimit")
        userDefaults.set(useCache, forKey: "UseCache")
        userDefaults.set(modelPath, forKey: "ModelPath")
    }
    
    private func loadSettings() {
        if let modelString = userDefaults.string(forKey: "EmbeddingModel"),
           let model = EmbeddingModel(rawValue: modelString) {
            embeddingModel = model
        }
        
        if userDefaults.object(forKey: "ChunkSize") != nil {
            chunkSize = userDefaults.integer(forKey: "ChunkSize")
        }
        
        if userDefaults.object(forKey: "ChunkOverlap") != nil {
            chunkOverlap = userDefaults.integer(forKey: "ChunkOverlap")
        }
        
        if userDefaults.object(forKey: "SearchResultsLimit") != nil {
            searchResultsLimit = userDefaults.integer(forKey: "SearchResultsLimit")
        }
        
        if userDefaults.object(forKey: "UseCache") != nil {
            useCache = userDefaults.bool(forKey: "UseCache")
        }
        
        if let path = userDefaults.string(forKey: "ModelPath") {
            modelPath = path
        }
    }
}