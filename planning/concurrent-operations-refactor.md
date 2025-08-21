# Concurrent Search/Indexing Refactoring Plan

## Problem Statement

Currently, when indexing is in progress, search operations hang indefinitely. This happens because:

1. **Python CLI processes commands sequentially** - The `handle_index()` method waits for indexing to complete before returning, blocking the main event loop from processing new commands
2. **Swift bridge uses blocking I/O** - The `sendCommandAndWaitWithProgress()` method blocks while waiting for responses, preventing other operations
3. **Single communication channel** - Both search and index operations share the same stdin/stdout pipes
4. **No request correlation** - Responses don't include request IDs, making it impossible to match responses to requests when multiple operations are in flight

## Root Cause Analysis

The architecture assumes a synchronous request-response pattern:
```
Swift -> Command -> Python -> Response -> Swift
```

But we need concurrent operations:
```
Swift -> Index Command -> Python (starts indexing)
Swift -> Search Command -> Python -> Search Response -> Swift
                           Python -> Index Response -> Swift (later)
```

## Proposed Solution: Request ID Based Multiplexing

### Core Concept
Add request IDs to enable proper request-response correlation and allow multiple concurrent operations.

### Implementation Plan

#### Phase 1: Protocol Enhancement

**1.1 Update Command Format**
```json
// Current
{"action": "search", "query": "test"}

// New
{"id": "req_123", "action": "search", "query": "test"}
```

**1.2 Update Response Format**
```json
// Current
{"success": true, "action": "search", "results": [...]}

// New  
{"id": "req_123", "success": true, "action": "search", "results": [...]}
```

**1.3 Status Messages Remain Unchanged**
```json
{"status": "processing_file", "current": 1, "total": 10, "file": "doc.pdf"}
```

#### Phase 2: Python CLI Refactoring

**2.1 Command Processing Changes**
- Add request ID tracking
- Process commands without blocking the event loop
- For indexing: Start async task, return immediately with acknowledgment
- For search: Process in thread pool, return when complete

**2.2 New Architecture**
```python
class AsyncSearchCLI:
    def __init__(self):
        self.pending_requests = {}  # Track in-flight requests
        
    async def process_command(self, line: str):
        command = json.loads(line)
        request_id = command.get("id", str(uuid.uuid4()))
        action = command.get("action")
        
        if action == "index":
            # Start indexing async, return acknowledgment immediately
            asyncio.create_task(self._handle_index_async(request_id, command))
            return {
                "id": request_id,
                "success": true,
                "action": "index",
                "status": "started"
            }
        elif action == "search":
            # Process search in thread pool
            return await self._handle_search_async(request_id, command)
```

**2.3 Async Index Handling**
```python
async def _handle_index_async(self, request_id: str, command: dict):
    """Run indexing in background, send completion when done"""
    try:
        # Perform indexing...
        result = await self._do_indexing(command["folder"])
        
        # Send completion response
        response = {
            "id": request_id,
            "success": True,
            "action": "index",
            "total_documents": result["documents"],
            "total_chunks": result["chunks"]
        }
        print(json.dumps(response), flush=True)
    except Exception as e:
        # Send error response
        response = {
            "id": request_id,
            "success": False,
            "action": "index",
            "error": str(e)
        }
        print(json.dumps(response), flush=True)
```

#### Phase 3: Swift Bridge Refactoring

**3.1 Response Handler Architecture**
- Maintain a dictionary of pending requests with continuations
- Read responses continuously in background
- Match responses to requests using IDs
- Handle out-of-order responses properly

**3.2 New Swift Architecture**
```swift
class PythonCLIBridge {
    private var pendingRequests: [String: CheckedContinuation<CLIResponse, Error>] = [:]
    private let requestQueue = DispatchQueue(label: "requests", attributes: .concurrent)
    
    func sendCommandAsync(_ command: [String: Any]) async throws -> CLIResponse {
        let requestId = UUID().uuidString
        var commandWithId = command
        commandWithId["id"] = requestId
        
        return try await withCheckedThrowingContinuation { continuation in
            requestQueue.async(flags: .barrier) {
                self.pendingRequests[requestId] = continuation
            }
            
            // Send command
            self.sendCommand(commandWithId)
        }
    }
    
    private func startResponseReader() {
        Task {
            while isRunning {
                if let response = await readNextResponse() {
                    if let requestId = response.id {
                        requestQueue.async(flags: .barrier) {
                            if let continuation = self.pendingRequests.removeValue(forKey: requestId) {
                                continuation.resume(returning: response)
                            }
                        }
                    }
                }
            }
        }
    }
}
```

**3.3 Separate Progress Handling**
- Progress updates (status messages) handled via callbacks
- Don't block waiting for final response
- Allow multiple operations to report progress simultaneously

#### Phase 4: UI Updates

**4.1 SearchViewModel Changes**
- Handle async indexing (show progress, don't block UI)
- Allow search while indexing is in progress
- Show both operations' status simultaneously

**4.2 Progress Indicators**
- Search: Show spinner while searching
- Indexing: Show progress bar with file count
- Both can be active at the same time

## Alternative Solutions Considered

### 1. Multiple Python Processes
- **Pros**: Complete isolation, no blocking
- **Cons**: Complex process management, duplicate memory usage, index synchronization issues

### 2. Separate Pipes for Different Operations  
- **Pros**: No message interleaving
- **Cons**: Complex pipe management, limited scalability

### 3. Move to HTTP/REST API
- **Pros**: Standard tooling, easy debugging
- **Cons**: Major refactor, overhead for local operations

### 4. Use XPC Services (macOS native)
- **Pros**: Native Apple solution, good for App Store
- **Cons**: Complete rewrite, Python integration complex

## Implementation Steps

1. **Step 1**: Add request ID support to Python CLI (backward compatible)
2. **Step 2**: Update Swift bridge to generate and track request IDs
3. **Step 3**: Implement async response reader in Swift
4. **Step 4**: Make Python indexing truly async (return immediately)
5. **Step 5**: Update UI to handle concurrent operations
6. **Step 6**: Remove debug stderr logging
7. **Step 7**: Add proper error handling for orphaned requests

## Testing Plan

1. **Unit Tests**
   - Test request ID generation and tracking
   - Test out-of-order response handling
   - Test timeout handling for lost responses

2. **Integration Tests**
   - Start indexing large folder
   - Perform multiple searches during indexing
   - Verify all responses received correctly
   - Test error cases (invalid folder, search errors)

3. **Performance Tests**
   - Measure search latency during indexing
   - Verify no blocking occurs
   - Check memory usage with multiple operations

## Rollback Plan

If issues arise:
1. Keep current synchronous mode as fallback
2. Add feature flag to enable/disable concurrent mode
3. Can revert to sequential processing if needed

## Timeline Estimate

- Protocol changes: 2 hours
- Python CLI refactor: 3 hours  
- Swift bridge refactor: 4 hours
- Testing and debugging: 3 hours
- **Total: ~12 hours**

## Benefits

1. **Non-blocking search** during indexing
2. **Better user experience** - responsive UI
3. **Foundation for future features** - cancel operations, parallel indexing
4. **Cleaner architecture** - proper async patterns
5. **No stderr abuse** - all communication via stdout with proper correlation