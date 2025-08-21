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

**2.2 Production-Safe Python Architecture (v1 - ThreadPool Only)**
```python
import sys, json, asyncio, uuid, signal, threading, sqlite3, os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

class AsyncSearchCLI:
    def __init__(self):
        self.tasks: dict[str, tuple[asyncio.Task, threading.Event]] = {}
        self.thread_pool = ThreadPoolExecutor(max_workers=max(4, (os.cpu_count() or 4)))
        self.cancel_tokens: dict[str, threading.Event] = {}
        self.loop: asyncio.AbstractEventLoop | None = None
        self._send_lock: asyncio.Lock | None = None
        
        # Configure unbuffered output - strict stdout discipline
        sys.stdout.reconfigure(line_buffering=True)
        
        # Initialize database with WAL mode for concurrent access
        self._init_database()
        
    def _init_database(self):
        """Initialize database directory structure"""
        # With snapshot/swap strategy, each generation has its own database
        # No shared connections or WAL mode needed
        self._setup_index_concurrency_policy()
        
    def _get_db_connection(self, generation_path: Path):
        """Get a properly configured SQLite connection for a specific generation"""
        db_path = generation_path / "metadata.db"
        conn = sqlite3.connect(
            str(db_path), 
            timeout=5.0, 
            check_same_thread=False
        )
        
        # Apply pragmas per connection
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA wal_autocheckpoint=1000")
        
        return conn
        
    def _setup_index_concurrency_policy(self):
        """Setup index read/write concurrency strategy"""
        # STRATEGY: Snapshot/swap (simplest and safest)
        # - Build new index in temp directory (index/gen-N)
        # - Atomically swap symlink/manifest on completion  
        # - Zero reader blocking, searches are always consistent
        # - Searches won't see new docs until indexing completes
        
        self.index_base_path = Path("data/index")
        self.index_base_path.mkdir(parents=True, exist_ok=True)
        
        # Create current symlink if it doesn't exist
        current_link = self.index_base_path / "current"
        if not current_link.exists():
            gen_0_path = self.index_base_path / "gen-0"
            gen_0_path.mkdir(exist_ok=True)
            current_link.symlink_to("gen-0")
            
    def _next_generation_path(self) -> Path:
        """Get path for next index generation"""
        nums = []
        for p in self.index_base_path.iterdir():
            if p.is_dir() and p.name.startswith("gen-"):
                try:
                    nums.append(int(p.name.split("-", 1)[1]))
                except:
                    pass
        n = (max(nums) + 1) if nums else 1
        path = self.index_base_path / f"gen-{n}"
        path.mkdir(exist_ok=True)
        return path
        
    def _finalize_generation(self, new_gen_path: Path):
        """Atomically swap to new index generation"""
        base = self.index_base_path
        tmp_link = base / "current_tmp"
        curr_link = base / "current"
        
        # Remove temporary link if it exists
        if tmp_link.exists():
            tmp_link.unlink()
            
        # Create temporary symlink to new generation (relative path)
        tmp_link.symlink_to(new_gen_path.name)
        
        # Atomic swap using os.replace
        os.replace(tmp_link, curr_link)
        
    def _cleanup_old_generations(self, keep: int = 2):
        """Remove old index generations to prevent disk bloat"""
        import shutil
        gens = sorted([p for p in self.index_base_path.iterdir() 
                      if p.is_dir() and p.name.startswith("gen-")])
        for p in gens[:-keep]:
            shutil.rmtree(p, ignore_errors=True)
            
    async def run(self):
        # Make Python the process group leader for proper cleanup (cross-platform guard)
        try:
            os.setsid()
        except Exception:
            pass  # Not available on some platforms; fine for macOS primary target
        
        # Capture event loop for thread-safe operations
        self.loop = asyncio.get_running_loop()
        self._send_lock = asyncio.Lock()
        
        # Protocol handshake with version info
        await self._send({"type": "hello", "protocol": "1.0", "features": ["cancel"], "pid": os.getpid()})
        
        # Setup graceful shutdown (cross-platform guard)
        try:
            self.loop.add_signal_handler(signal.SIGTERM, 
                                        lambda: asyncio.create_task(self._graceful_shutdown()))
        except Exception:
            pass  # Signal handlers not available on all platforms
        
        # Process commands with heartbeat
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await self.loop.connect_read_pipe(lambda: protocol, sys.stdin)
        
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                try:
                    cmd = json.loads(line.decode().strip())
                    asyncio.create_task(self._handle(cmd))
                except json.JSONDecodeError as e:
                    await self._send({"type": "error", "id": None, "code": "JSON_PARSE", "message": str(e)})
                except Exception as e:
                    await self._send({"type": "error", "id": cmd.get("id"), "code": "COMMAND_ERROR", "message": str(e)})
        finally:
            heartbeat_task.cancel()
            
    async def _heartbeat_loop(self):
        """Send periodic heartbeats to keep connection alive"""
        while True:
            await asyncio.sleep(3.0)  # Send every 3 seconds
            # Always send heartbeat - Swift uses this for liveness detection
            await self._send({"type": "event", "id": None, "status": "heartbeat"})
                
    async def _handle(self, cmd):
        request_id = cmd.get("id") or str(uuid.uuid4())
        action = cmd.get("action")
        
        if action == "index":
            # Create cancel token for threading
            cancel_token = threading.Event()
            self.cancel_tokens[request_id] = cancel_token
            
            # Start indexing async with cooperative cancellation
            task = asyncio.create_task(self._handle_index_async(request_id, cmd, cancel_token))
            self.tasks[request_id] = (task, cancel_token)
            
            # Send event (not response) for started status
            await self._send({
                "type": "event", 
                "id": request_id,
                "action": "index", 
                "status": "started"
            })
            
        elif action == "search":
            # Create cancel token and store search task for cancellation
            cancel_token = threading.Event()
            self.cancel_tokens[request_id] = cancel_token
            
            try:
                search_task = asyncio.create_task(
                    self.loop.run_in_executor(self.thread_pool, self._search_with_cancel, cmd, cancel_token)
                )
                
                # Store task for cancellation support
                self.tasks[request_id] = (search_task, cancel_token)
                
                result = await search_task
                
                # Send search results (no chunking in v1)
                await self._send({
                    "type": "response",
                    "id": request_id, 
                    "success": True,
                    "action": "search",
                    "results": result
                })
            except asyncio.CancelledError:
                # Send cancellation response
                await self._send({
                    "type": "response",
                    "id": request_id,
                    "success": False,
                    "action": "search",
                    "cancelled": True
                })
            except Exception as e:
                await self._send({
                    "type": "error",
                    "id": request_id,
                    "code": "SEARCH_ERROR", 
                    "message": str(e)
                })
            finally:
                self.cancel_tokens.pop(request_id, None)
                self.tasks.pop(request_id, None)
                
        elif action == "cancel":
            target = cmd.get("target")
            found = False
            
            if target in self.tasks:
                task, cancel_token = self.tasks.pop(target)
                cancel_token.set()
                task.cancel()
                found = True
                
            if token := self.cancel_tokens.pop(target, None):
                token.set()
                found = True
                
            await self._send({
                "type": "response",
                "id": request_id,
                "success": found,
                "action": "cancel",
                "target": target
            })
            
        elif action == "shutdown":
            await self._graceful_shutdown(request_id)
            
        else:
            await self._send({
                "type": "error",
                "id": request_id,
                "code": "UNKNOWN_ACTION",
                "message": f"Unknown action: {action}"
            })
    
    def _search_with_cancel(self, cmd, cancel_token):
        """Cancellable search implementation with per-op SQLite connection"""
        # Resolve current generation for consistent snapshot
        curr_gen = (self.index_base_path / "current").resolve()
        
        # Open per-operation SQLite connection
        with self._get_db_connection(curr_gen) as conn:
            # Check cancel token periodically during search
            if cancel_token.is_set():
                raise asyncio.CancelledError("Search cancelled")
            
            # Perform search with cooperative cancellation checks
            results = []
            # Simulate search loop with cancellation checks
            for i in range(10):  # Example search chunks
                if cancel_token.is_set():
                    raise asyncio.CancelledError("Search cancelled")
                # ... actual search logic here
                
            return results
        
    # Chunked responses removed for v1 - can be added later if needed
            
    async def _send(self, obj):
        """Send NDJSON message with proper flushing - stdout only for structured data"""
        # NEVER print non-JSON to stdout - use stderr for human logs
        try:
            data = json.dumps(obj) + "\n"
            async with self._send_lock:
                sys.stdout.write(data)
                sys.stdout.flush()
        except Exception as e:
            # Log errors to stderr, never stdout
            print(f"Failed to send message: {e}", file=sys.stderr)
        
    def _thread_safe_progress(self, request_id, action, **kwargs):
        """Thread-safe progress callback for executor tasks"""
        self.loop.call_soon_threadsafe(
            asyncio.create_task, 
            self._send({"type": "event", "id": request_id, "action": action, **kwargs})
        )
        
    async def _graceful_shutdown(self, request_id: str = None):
        """Cancel all tasks and shutdown cleanly"""
        # Signal all operations to cancel
        for cancel_token in self.cancel_tokens.values():
            cancel_token.set()
            
        # Cancel all async tasks
        for task, _ in self.tasks.values():
            task.cancel()
            
        # Wait for tasks to complete
        if self.tasks:
            await asyncio.gather(*[task for task, _ in self.tasks.values()], return_exceptions=True)
            
        # Shutdown thread pool
        self.thread_pool.shutdown(wait=False)
        
        # Send shutdown confirmation with matching ID for deterministic teardown
        await self._send({"type": "response", "id": request_id, "success": True, "action": "shutdown"})
        sys.exit(0)
```

**2.3 Async Index Handling with Cooperative Cancellation**
```python
async def _handle_index_async(self, request_id: str, command: dict, cancel_token: threading.Event):
    """Run indexing in background with cooperative cancellation"""
    try:
        folder = command["folder"]
        
        # Send progress events with request ID and action
        await self._send({
            "type": "event",
            "id": request_id,
            "action": "index",
            "status": "scanning_folder",
            "folder": folder
        })
        
        # Check cancellation before starting
        if cancel_token.is_set():
            raise asyncio.CancelledError("Operation cancelled")
        
        # Get new generation path for this index operation
        gen_path = self._next_generation_path()
        
        # Run indexing in thread pool with progress callbacks
        def progress_callback(**kwargs):
            if cancel_token.is_set():
                return  # Don't send progress if cancelled
            self._thread_safe_progress(request_id, "index", **kwargs)
        
        result = await self.loop.run_in_executor(
            self.thread_pool,
            self._index_worker_thread,
            folder, gen_path, cancel_token, progress_callback
        )
        
        # Atomically swap to new generation on success
        self._finalize_generation(gen_path)
        
        # Clean up old generations to prevent disk bloat
        self._cleanup_old_generations(keep=2)
        
        # Check cancellation after completion
        if cancel_token.is_set():
            raise asyncio.CancelledError("Operation cancelled")
        
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
    except Exception as e:
        # Clean up failed generation
        import shutil
        shutil.rmtree(gen_path, ignore_errors=True)
        
        await self._send({
            "type": "error",
            "id": request_id,
            "code": "INDEX_ERROR",
            "message": str(e),
            "details": {"folder": command.get("folder")}
        })
    finally:
        self.tasks.pop(request_id, None)
        self.cancel_tokens.pop(request_id, None)
        
def _index_worker_thread(self, folder, gen_path, cancel_token, progress_callback):
    """Thread worker for I/O-bound indexing with cooperative cancellation"""
    import time
    documents_processed = 0
    
    # Open per-operation SQLite connection for this generation
    with self._get_db_connection(gen_path) as conn:
        try:
            # Scan files with cancellation checks
            files = []
            for root, dirs, filenames in os.walk(folder):
                if cancel_token.is_set():
                    raise asyncio.CancelledError("Indexing cancelled")
                
                for filename in filenames:
                    files.append(os.path.join(root, filename))
                    
            progress_callback(status="files_found", count=len(files))
            
            # Process files with throttled progress updates
            last_emit = 0
            for i, file_path in enumerate(files):
                if cancel_token.is_set():
                    raise asyncio.CancelledError("Indexing cancelled")
                    
                # Process file...
                # ... actual indexing logic here using conn ...
                
                # Throttle progress events to ~20Hz to prevent pipe overflow
                now = time.monotonic()
                if now - last_emit > 0.05 or i + 1 == len(files):  # 20Hz max, always emit last
                    progress_callback(
                        status="processing_file", 
                        current=i+1, 
                        total=len(files), 
                        file=file_path
                    )
                    last_emit = now
                    
                documents_processed += 1
                
            return {"documents": documents_processed, "chunks": documents_processed * 3}
            
        except asyncio.CancelledError:
            progress_callback(status="cancelled", processed=documents_processed)
            raise

    # Removed _is_cpu_intensive_indexing - v1 uses ThreadPool only
```

#### Phase 3: Swift Bridge Refactoring

**3.1 Response Handler Architecture**
- Maintain a dictionary of pending requests with continuations
- Read responses continuously in background
- Match responses to requests using IDs
- Handle out-of-order responses properly

**3.2 Production-Safe Swift Architecture**
```swift
struct CLIMessage: Decodable {
    let type: String      // "hello" | "response" | "event" | "error" | "log"
    let id: String?
    let action: String?
    let success: Bool?
    let proto: String?    // Maps from "protocol" field
    let target: String?   // For cancel responses
    
    enum CodingKeys: String, CodingKey {
        case type, id, action, success, target
        case proto = "protocol"
    }
}

actor PendingRequestsManager {
    private var waiters: [String: (CheckedContinuation<CLIMessage, Error>, Date)] = [:]
    private let timeoutInterval: TimeInterval = 30.0
    
    func add(_ id: String, _ continuation: CheckedContinuation<CLIMessage, Error>) {
        waiters[id] = (continuation, Date())
        scheduleTimeoutCheck()
    }
    
    func complete(_ id: String) -> CheckedContinuation<CLIMessage, Error>? {
        return waiters.removeValue(forKey: id)?.0
    }
    
    func failAll(_ error: Error) {
        for (_, (continuation, _)) in waiters {
            continuation.resume(throwing: error)
        }
        waiters.removeAll()
    }
    
    private func scheduleTimeoutCheck() {
        Task {
            try? await Task.sleep(nanoseconds: UInt64(timeoutInterval * 1_000_000_000))
            await cleanupTimedOutRequests()
        }
    }
    
    private func cleanupTimedOutRequests() {
        let now = Date()
        let timeoutError = NSError(domain: "cli", code: 3, 
                                  userInfo: [NSLocalizedDescriptionKey: "Request timeout"])
        
        for (id, (continuation, timestamp)) in waiters {
            if now.timeIntervalSince(timestamp) > timeoutInterval {
                waiters.removeValue(forKey: id)
                continuation.resume(throwing: timeoutError)
            }
        }
    }
}

class PythonCLIBridge {
    private let pendingRequests = PendingRequestsManager()
    private let process = Process()
    private let inPipe = Pipe()
    private let outPipe = Pipe()
    
    // Serialize all stdin writes to prevent interleaving
    private let writeQueue = DispatchQueue(label: "cli.stdin.write")
    
    // Single reader guarantee
    private var readerStarted = false
    private let readerLock = NSLock()
    
    // Heartbeat tracking
    private var lastHeartbeat = Date()
    private var watchdogTask: Task<Void, Never>?
    
    init(pythonPath: URL, scriptPath: URL) {
        process.executableURL = pythonPath
        process.arguments = ["-u", scriptPath.path]  // Unbuffered I/O
        process.standardInput = inPipe
        process.standardOutput = outPipe
        process.standardError = FileHandle.standardError
        
        // Process group will be handled by Python calling os.setsid()
        
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
        
        readerLock.lock()
        defer { readerLock.unlock() }
        
        guard !readerStarted else {
            throw NSError(domain: "cli", code: 4, 
                         userInfo: [NSLocalizedDescriptionKey: "Reader already started"])
        }
        readerStarted = true
        
        // Start heartbeat watchdog
        watchdogTask = Task.detached { [weak self] in
            while let self = self {
                try? await Task.sleep(nanoseconds: 3_000_000_000) // Check every 3s
                if Date().timeIntervalSince(self.lastHeartbeat) > 15.0 {
                    await self.pendingRequests.failAll(
                        NSError(domain: "cli", code: 6,
                               userInfo: [NSLocalizedDescriptionKey: "Heartbeat timeout - Python may be unresponsive"])
                    )
                    break
                }
            }
        }
        
        Task { await startNDJSONReader() }
    }
    
    func stop() {
        // Cancel watchdog
        watchdogTask?.cancel()
        
        // Graceful shutdown with proper process termination
        Task {
            try? await sendCommand(["action": "shutdown"])
            // Allow brief time for graceful exit
            try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
            
            if process.isRunning {
                process.terminate()
                try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 second
            }
            
            if process.isRunning {
                // Kill process group to catch any spawned workers
                kill(-process.processIdentifier, SIGKILL)
            }
        }
    }
    
    func sendCommand(_ command: [String: Any]) async throws -> CLIMessage {
        var cmd = command
        let id = (cmd["id"] as? String) ?? UUID().uuidString
        cmd["id"] = id
        
        return try await withCheckedThrowingContinuation { continuation in
            Task {
                await pendingRequests.add(id, continuation)
                
                // Serialize all writes to prevent interleaving
                writeQueue.async { [weak self] in
                    guard let self = self else { return }
                    
                    do {
                        let data = try JSONSerialization.data(withJSONObject: cmd)
                        self.inPipe.fileHandleForWriting.write(data)
                        self.inPipe.fileHandleForWriting.write(Data([0x0A])) // newline for NDJSON
                    } catch {
                        Task {
                            if let cont = await self.pendingRequests.complete(id) {
                                cont.resume(throwing: error)
                            }
                        }
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
                    // Update heartbeat and validate protocol
                    self.lastHeartbeat = Date()
                    guard let protocol = message.proto, protocol == "1.0" else {
                        await pendingRequests.failAll(
                            NSError(domain: "cli", code: 5,
                                   userInfo: [NSLocalizedDescriptionKey: "Unsupported protocol version"])
                        )
                        return
                    }
                    print("Python CLI ready with protocol \(protocol)")
                    
                case "response":
                    // Update heartbeat on all messages
                    self.lastHeartbeat = Date()
                    if let id = message.id,
                       let continuation = await pendingRequests.complete(id) {
                        continuation.resume(returning: message)
                    }
                    
                case "event":
                    // Update heartbeat tracking for ANY event
                    self.lastHeartbeat = Date()
                    
                    // Handle progress events - publish to UI
                    await handleProgressEvent(message)
                    
                case "error":
                    // Update heartbeat on all messages
                    self.lastHeartbeat = Date()
                    if let id = message.id,
                       let continuation = await pendingRequests.complete(id) {
                        let error = NSError(domain: "cli", code: 2, 
                                           userInfo: [NSLocalizedDescriptionKey: "CLI Error: \(message)"])
                        continuation.resume(throwing: error)
                    }
                    
                case "log":
                    // Update heartbeat on all messages
                    self.lastHeartbeat = Date()
                    // System logs only - never mixed with stdout JSON
                    FileHandle.standardError.write(Data("CLI Log: \(message)\n".utf8))
                    
                default:
                    FileHandle.standardError.write(Data("Unknown message type: \(message.type)\n".utf8))
                }
                
                // Heartbeat timeout is now handled by watchdog task
                
            } catch {
                FileHandle.standardError.write(Data("Failed to decode CLI message: \(error)\n".utf8))
            }
        }
        
        // EOF reached - fail all pending requests
        await pendingRequests.failAll(
            NSError(domain: "cli", code: 7,
                   userInfo: [NSLocalizedDescriptionKey: "CLI transport closed"])
        )
    }
    
    private func handleProgressEvent(_ message: CLIMessage) async {
        // Publish progress events to UI via Combine/AsyncStream
        // This allows multiple operations to show progress simultaneously
        await publishProgressEvent(message)
    }
    
    private func publishProgressEvent(_ message: CLIMessage) async {
        // Publish to UI - allows multiple operations to show progress simultaneously
        // Implementation details for UI updates
    }
}

// Note: FileHandle.standardError is used directly for error logging
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

## Implementation Steps (v1 - ThreadPool Only)

### Phase 1: Foundation (Production-Safe Protocols)
1. **Step 1**: Implement NDJSON framing with strict stdout discipline  
2. **Step 2**: Add protocol handshake with version validation
3. **Step 3**: Implement snapshot/swap index strategy with atomic os.replace
4. **Step 4**: Add structured error codes and message types

### Phase 2: Concurrency & Cancellation  
5. **Step 5**: Implement cooperative cancellation with threading.Event tokens
6. **Step 6**: ThreadPool-only implementation for I/O-bound operations
7. **Step 7**: Implement thread-safe progress callbacks with call_soon_threadsafe
8. **Step 8**: Ensure exactly one terminal response per request

### Phase 3: Swift Bridge Hardening
9. **Step 9**: Add serialized write queue to prevent pipe interleaving
10. **Step 10**: Implement actor-based request management with timeouts
11. **Step 11**: Add single reader guarantee and heartbeat monitoring  
12. **Step 12**: Implement proper process group termination with os.setsid()

### Phase 4: Integration & Testing
13. **Step 13**: Update UI to handle concurrent operations and progress streams
14. **Step 14**: Add comprehensive error scenarios and timeout testing
15. **Step 15**: Test cancellation races and process crash recovery

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

## Timeline Estimate (v1 - ThreadPool Only)

### Phase 1: Foundation (Production-Safe Protocols)
- NDJSON framing + stdout discipline: 2 hours
- Protocol handshake + version validation: 1 hour
- Snapshot/swap implementation: 2 hours  
- Structured error codes: 1 hour

### Phase 2: Concurrency & Cancellation
- Cooperative cancellation system: 2 hours
- ThreadPool implementation: 1 hour
- Thread-safe progress callbacks: 2 hours
- One terminal response per request: 1 hour

### Phase 3: Swift Bridge Hardening  
- Serialized write queue: 1 hour
- Actor-based request management: 3 hours
- Heartbeat monitoring: 1 hour
- Process group termination: 1 hour

### Phase 4: Integration & Testing
- UI concurrent operations: 2 hours
- Comprehensive testing: 3 hours
- Edge case debugging: 2 hours

**Total: ~18 hours** (reduced by removing ProcessPool and chunking complexity)

## Benefits

1. **Non-blocking search** during indexing
2. **Better user experience** - responsive UI with concurrent progress tracking
3. **Robust error handling** - structured errors with proper propagation
4. **Graceful shutdown** - clean process termination and resource cleanup
5. **Foundation for future features** - cancel operations, parallel indexing
6. **Production-ready architecture** - proper async patterns with NDJSON framing
7. **Protocol versioning** - handshake enables safe evolution