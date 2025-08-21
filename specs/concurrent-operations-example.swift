// Example: How Concurrent Search + Indexing Works
// This demonstrates the async nature of our implementation

import Foundation

// MARK: - Concurrent Operations Example

class ConcurrentExample {
    
    // Both operations can run simultaneously
    func demonstrateConcurrentOperations() async {
        
        // Start indexing in background
        Task {
            await indexLargeFolder()
        }
        
        // User can search immediately (uses existing index)
        Task {
            await performSearch(query: "swift programming")
        }
        
        // User can search again while indexing continues
        Task {
            await Task.sleep(nanoseconds: 2_000_000_000) // Wait 2 seconds
            await performSearch(query: "machine learning")
        }
    }
    
    // MARK: - Background Indexing
    
    func indexLargeFolder() async {
        print("📁 Starting to index folder...")
        
        for i in 1...100 {
            // Simulate processing each file
            await Task.sleep(nanoseconds: 100_000_000) // 0.1 second per file
            
            // Update progress (non-blocking)
            await MainActor.run {
                updateProgress(current: i, total: 100, fileName: "document_\(i).pdf")
            }
            
            // Check for cancellation
            if Task.isCancelled {
                print("❌ Indexing cancelled at file \(i)")
                return
            }
        }
        
        print("✅ Indexing complete!")
    }
    
    // MARK: - Search Operations
    
    func performSearch(query: String) async {
        print("🔍 Searching for: '\(query)'")
        
        // Search happens independently of indexing
        // Uses whatever index exists at this moment
        await Task.sleep(nanoseconds: 500_000_000) // Simulate search time
        
        print("✅ Search complete for: '\(query)'")
        // Returns results from current index state
    }
    
    // MARK: - UI Updates (Main Thread)
    
    @MainActor
    func updateProgress(current: Int, total: Int, fileName: String) {
        // Update UI without blocking
        print("Progress: \(current)/\(total) - \(fileName)")
    }
}

// MARK: - Timeline Example

/*
Timeline of concurrent operations:

Time    | Indexing Thread           | Search Thread           | UI Thread
--------|---------------------------|-------------------------|------------------
0.0s    | Start indexing file 1     |                        | Show status bar
0.1s    | Processing file 2         | User searches "swift"  | Update progress
0.2s    | Processing file 3         | Search completes       | Show results
0.3s    | Processing file 4         |                        | Update progress
0.5s    | Processing file 6         | User searches "AI"     | Update search box
0.6s    | Processing file 7         | Search completes       | Show new results
...     | ...                       | ...                    | ...
10.0s   | Indexing complete         |                        | Status: Ready

Key Points:
1. Indexing runs in background Task
2. Search operations are independent Tasks
3. UI remains responsive throughout
4. Each operation has its own error handling
5. Cancellation is supported via Task cancellation
*/

// MARK: - Benefits

/*
Benefits of this approach:

1. **User Experience**
   - No waiting for indexing to complete
   - Can search partial index
   - UI never freezes
   
2. **Performance**
   - Utilizes async/await for efficiency
   - No thread blocking
   - Automatic concurrency management
   
3. **Reliability**
   - Each operation is isolated
   - Errors don't affect other operations
   - Graceful cancellation
   
4. **Code Simplicity**
   - Clean async/await syntax
   - No complex threading code
   - Clear separation of concerns
*/