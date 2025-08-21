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

**1.3 Structured Message Types with Request IDs**
All messages now include type classification and request IDs:
```json
// Status/progress events (during operations)
{"type": "event", "id": "req_123", "status": "processing_file", "current": 1, "total": 10, "file": "doc.pdf"}

// Final responses  
{"type": "response", "id": "req_123", "success": true, "action": "search", "results": [...]}

// Errors
{"type": "error", "id": "req_123", "code": "INDEX_IO", "message": "Failed to read file", "details": {...}}

// System events
{"type": "log", "id": null, "level": "info", "message": "System ready"}
```

#### Phase 2: Python CLI Refactoring

**2.1 Command Processing Changes**
- Add request ID tracking
- Process commands without blocking the event loop  
- Use NDJSON with unbuffered I/O (launch Python with `-u` flag)
- For indexing: Start async task, return immediately with acknowledgment
- For search: Process in thread pool, return when complete
- Add protocol handshake for version compatibility
- Support graceful shutdown and operation cancellation

**2.2 New Architecture with Protocol Handshake**
```python
import sys, json, asyncio, uuid, signal
from concurrent.futures import ThreadPoolExecutor

class AsyncSearchCLI:
    def __init__(self):
        self.tasks = {}  # id -> asyncio.Task  
        self.thread_pool = ThreadPoolExecutor()
        # Configure unbuffered output
        sys.stdout.reconfigure(line_buffering=True)
        
    async def run(self):
        # Protocol handshake
        await self._send({"type": "hello", "protocol": "1.0"})
        
        # Setup graceful shutdown
        loop = asyncio.get_running_loop()
        loop.add_signal_handler(signal.SIGTERM, 
                               lambda: asyncio.create_task(self._graceful_shutdown()))
        
        # Process commands
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await loop.connect_read_pipe(lambda: protocol, sys.stdin)
        
        while True:
            line = await reader.readline()
            if not line:
                break
            try:
                cmd = json.loads(line.decode().strip())
                asyncio.create_task(self._handle(cmd))
            except Exception as e:
                await self._send({"type": "error", "id": cmd.get("id"), "message": str(e)})
                
    async def _handle(self, cmd):
        request_id = cmd.get("id") or str(uuid.uuid4())
        action = cmd.get("action")
        
        if action == "index":
            # Start indexing async, return acknowledgment immediately
            task = asyncio.create_task(self._handle_index_async(request_id, cmd))
            self.tasks[request_id] = task
            await self._send({
                "type": "response", 
                "id": request_id,
                "success": True,
                "action": "index", 
                "status": "started"
            })
        elif action == "search":
            # Process search in thread pool
            result = await asyncio.get_running_loop().run_in_executor(
                self.thread_pool, self._search_sync, cmd)
            await self._send({
                "type": "response",
                "id": request_id, 
                "success": True,
                "action": "search",
                "results": result
            })
        elif action == "cancel":
            task = self.tasks.pop(request_id, None)
            if task:
                task.cancel()
            await self._send({
                "type": "response",
                "id": request_id,
                "success": True,
                "action": "cancel"
            })
        elif action == "shutdown":
            await self._graceful_shutdown()
        else:
            await self._send({
                "type": "error",
                "id": request_id,
                "message": f"Unknown action: {action}"
            })
            
    async def _send(self, obj):
        """Send NDJSON message with proper flushing"""
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()
        
    async def _graceful_shutdown(self):
        """Cancel all tasks and exit gracefully"""
        for task in list(self.tasks.values()):
            task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)
        await self._send({"type": "event", "id": None, "status": "shutting_down"})
        sys.exit(0)
```

**2.3 Async Index Handling with Progress Events**
```python
async def _handle_index_async(self, request_id: str, command: dict):
    """Run indexing in background, send progress events and completion"""
    try:
        folder = command["folder"]
        
        # Send progress events with request ID
        await self._send({
            "type": "event",
            "id": request_id, 
            "status": "scanning_folder",
            "folder": folder
        })
        
        # Perform indexing with progress callbacks
        result = await self._do_indexing(
            folder, 
            progress_callback=lambda **kwargs: asyncio.create_task(
                self._send({
                    "type": "event",
                    "id": request_id,
                    **kwargs
                })
            )
        )
        
        # Send completion response
        await self._send({
            "type": "response",
            "id": request_id,
            "success": True,
            "action": "index",
            "total_documents": result["documents"],
            "total_chunks": result["chunks"]
        })
        
    except asyncio.CancelledError:
        await self._send({
            "type": "response",
            "id": request_id,
            "success": False,
            "action": "index",
            "cancelled": True
        })
        raise
    except Exception as e:
        await self._send({
            "type": "error",
            "id": request_id,
            "code": "INDEX_ERROR",
            "message": str(e),
            "details": {"folder": command.get("folder")}
        })
    finally:
        self.tasks.pop(request_id, None)
```

#### Phase 3: Swift Bridge Refactoring

**3.1 Response Handler Architecture**
- Maintain a dictionary of pending requests with continuations
- Read responses continuously in background
- Match responses to requests using IDs
- Handle out-of-order responses properly

**3.2 New Swift Architecture with NDJSON and Message Types**
```swift
struct CLIMessage: Decodable {
    let type: String      // "hello" | "response" | "event" | "error" | "log"
    let id: String?
    let action: String?
    let success: Bool?
    // Additional fields handled via generic payload or specific properties
}

actor PendingRequestsManager {
    private var waiters: [String: CheckedContinuation<CLIMessage, Error>] = [:]
    
    func add(_ id: String, _ continuation: CheckedContinuation<CLIMessage, Error>) {
        waiters[id] = continuation
    }
    
    func complete(_ id: String) -> CheckedContinuation<CLIMessage, Error>? {
        return waiters.removeValue(forKey: id)
    }
    
    func failAll(_ error: Error) {
        for (_, continuation) in waiters {
            continuation.resume(throwing: error)
        }
        waiters.removeAll()
    }
}

class PythonCLIBridge {
    private let pendingRequests = PendingRequestsManager()
    private let process = Process()
    private let inPipe = Pipe()
    private let outPipe = Pipe()
    
    init(pythonPath: URL, scriptPath: URL) {
        process.executableURL = pythonPath
        process.arguments = ["-u", scriptPath.path]  // Unbuffered I/O
        process.standardInput = inPipe
        process.standardOutput = outPipe
        process.standardError = FileHandle.standardError
        
        process.terminationHandler = { [weak self] _ in
            Task {
                await self?.pendingRequests.failAll(
                    NSError(domain: "cli", code: 1, 
                           userInfo: [NSLocalizedDescriptionKey: "Python process exited"])
                )
            }
        }
    }
    
    func start() throws {
        try process.run()
        Task { await startNDJSONReader() }
    }
    
    func stop() {
        // Graceful shutdown
        Task {
            try? await sendCommand(["action": "shutdown"])
            // Allow brief time for graceful exit
            try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
            if process.isRunning { process.terminate() }
            if process.isRunning { process.kill() }
        }
    }
    
    func sendCommand(_ command: [String: Any]) async throws -> CLIMessage {
        var cmd = command
        let id = (cmd["id"] as? String) ?? UUID().uuidString
        cmd["id"] = id
        
        return try await withCheckedThrowingContinuation { continuation in
            Task {
                await pendingRequests.add(id, continuation)
                
                do {
                    let data = try JSONSerialization.data(withJSONObject: cmd)
                    inPipe.fileHandleForWriting.write(data)
                    inPipe.fileHandleForWriting.write(Data([0x0A])) // newline for NDJSON
                } catch {
                    if let cont = await pendingRequests.complete(id) {
                        cont.resume(throwing: error)
                    }
                }
            }
        }
    }
    
    private func startNDJSONReader() async {
        let handle = outPipe.fileHandleForReading
        
        for await line in handle.bytes.lines {
            guard let data = line.data(using: .utf8) else { continue }
            
            do {
                let message = try JSONDecoder().decode(CLIMessage.self, from: data)
                
                switch message.type {
                case "hello":
                    // Validate protocol version
                    print("Python CLI ready with protocol version")
                    
                case "response":
                    if let id = message.id,
                       let continuation = await pendingRequests.complete(id) {
                        continuation.resume(returning: message)
                    }
                    
                case "event":
                    // Handle progress events - publish to UI
                    await handleProgressEvent(message)
                    
                case "error":
                    if let id = message.id,
                       let continuation = await pendingRequests.complete(id) {
                        let error = NSError(domain: "cli", code: 2, 
                                           userInfo: [NSLocalizedDescriptionKey: "CLI Error: \(message)"])
                        continuation.resume(throwing: error)
                    }
                    
                case "log":
                    // Handle system log messages
                    print("CLI Log: \(message)")
                    
                default:
                    print("Unknown message type: \(message.type)")
                }
                
            } catch {
                print("Failed to decode CLI message: \(error)")
            }
        }
    }
    
    private func handleProgressEvent(_ message: CLIMessage) async {
        // Publish progress events to UI via Combine/AsyncStream
        // This allows multiple operations to show progress simultaneously
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

1. **Step 1**: Add NDJSON framing and message types to Python CLI
2. **Step 2**: Implement protocol handshake and graceful shutdown
3. **Step 3**: Add request ID support with structured error handling  
4. **Step 4**: Update Swift bridge with unbuffered I/O and NDJSON reader
5. **Step 5**: Implement actor-based request management in Swift
6. **Step 6**: Make Python indexing truly async with proper cancellation
7. **Step 7**: Update UI to handle concurrent operations and progress streams
8. **Step 8**: Add operation cancellation support
9. **Step 9**: Test concurrent operations and error scenarios

## Testing Plan

1. **Protocol Tests**
   - Test NDJSON framing with fragmented/partial reads
   - Test protocol handshake validation
   - Test message type classification and routing
   - Test request ID generation and correlation

2. **Concurrency Tests**  
   - Start indexing large folder + perform 20 concurrent searches
   - Test operation cancellation during execution
   - Test graceful shutdown with pending operations
   - Verify no deadlocks or continuation leaks

3. **Error Handling Tests**
   - Simulate Python process crash mid-operation
   - Test invalid commands and malformed JSON
   - Test timeout scenarios and orphaned requests
   - Test error propagation with proper error codes

4. **Performance Tests**
   - Measure search latency during indexing
   - Verify no blocking occurs with concurrent operations
   - Check memory usage and actor performance
   - Test with high-frequency operations

## Rollback Plan

If issues arise:
1. Keep current synchronous mode as fallback
2. Add feature flag to enable/disable concurrent mode
3. Can revert to sequential processing if needed

## Timeline Estimate

- NDJSON protocol implementation: 3 hours
- Python async CLI with handshake/shutdown: 4 hours  
- Swift bridge with actors and NDJSON reader: 5 hours
- Cancellation and error handling: 3 hours
- Testing and debugging: 4 hours
- **Total: ~19 hours**

## Benefits

1. **Non-blocking search** during indexing
2. **Better user experience** - responsive UI with concurrent progress tracking
3. **Robust error handling** - structured errors with proper propagation
4. **Graceful shutdown** - clean process termination and resource cleanup
5. **Foundation for future features** - cancel operations, parallel indexing
6. **Production-ready architecture** - proper async patterns with NDJSON framing
7. **Protocol versioning** - handshake enables safe evolution