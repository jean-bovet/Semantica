#!/usr/bin/env python3
"""
Async version of the CLI that can handle search requests while indexing.
This allows searches to be performed while indexing is in progress.
"""
import asyncio
import json
import sys
import os
from typing import Optional, Dict, Any
from pathlib import Path
import signal
from concurrent.futures import ThreadPoolExecutor
import threading
import time

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Also add src directory to path so internal imports work
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src'))

from src.search import DocumentSearchEngine
from src.indexer import FAISSIndexer


class AsyncSearchCLI:
    def __init__(self):
        self.search_engine = None
        self.indexing_task = None
        self.indexing_status = {"is_indexing": False, "progress": {}}
        self.executor = ThreadPoolExecutor(max_workers=2)
        self.should_exit = False
        self.parent_pid = os.getppid()  # Store parent process ID
        
    async def initialize(self):
        """Initialize the search engine"""
        try:
            # Run initialization in thread pool since it's blocking I/O
            await asyncio.get_event_loop().run_in_executor(
                self.executor,
                self._init_search_engine
            )
            print(json.dumps({"status": "initialized", "success": True}), flush=True)
        except Exception as e:
            print(json.dumps({"status": "error", "error": str(e)}), flush=True)
            
    def _init_search_engine(self):
        """Blocking initialization - runs in thread pool"""
        self.search_engine = DocumentSearchEngine(
            json_mode=True,
            num_workers=4,
            enable_incremental=True
        )
        
    async def handle_search(self, query: str, limit: int = 10) -> Dict[str, Any]:
        """Handle search request - can run while indexing"""
        if not self.search_engine:
            return {"success": False, "error": "Engine not initialized"}
            
        try:
            # Run search in thread pool since FAISS operations are blocking
            results = await asyncio.get_event_loop().run_in_executor(
                self.executor,
                self._perform_search,
                query,
                limit
            )
            
            # Format results
            formatted_results = []
            for chunk, score in results:
                formatted_results.append({
                    "file_path": chunk.metadata.get("file_path", ""),
                    "file_name": os.path.basename(chunk.metadata.get("file_path", "")),
                    "score": float(score),
                    "preview": chunk.content[:200],
                    "page_number": chunk.metadata.get("page_number")
                })
                
            return {
                "success": True,
                "action": "search",
                "results": formatted_results
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
            
    def _perform_search(self, query: str, limit: int):
        """Blocking search operation - runs in thread pool"""
        return self.search_engine.search(query, k=limit, display_results=False)
        
    async def handle_index(self, folder: str) -> Dict[str, Any]:
        """Handle indexing request - waits for completion"""
        if self.indexing_status["is_indexing"]:
            return {
                "success": False,
                "error": "Indexing already in progress",
                "current_status": self.indexing_status["progress"]
            }
            
        # Run indexing and wait for it to complete
        result = await self._index_folder_async(folder)
        
        # Use the result if available, otherwise get from statistics
        if result:
            return {
                "success": True,
                "action": "index",
                "total_documents": result.get("documents", 0),
                "total_chunks": result.get("chunks", 0)
            }
        
        # Fallback to getting statistics
        stats = self.search_engine.indexer.get_statistics()
        return {
            "success": True,
            "action": "index",
            "total_documents": stats.get("total_documents", 0),
            "total_chunks": stats.get("total_chunks", 0)
        }
        
    async def _index_folder_async(self, folder: str):
        """Async wrapper for indexing - reports progress"""
        self.indexing_status["is_indexing"] = True
        self.indexing_status["progress"] = {
            "folder": folder,
            "status": "starting"
        }
        
        try:
            # Report that indexing is starting
            print(json.dumps({
                "status": "indexing_started",
                "folder": folder
            }), flush=True)
            
            # Force flush stdout to ensure message is sent immediately
            sys.stdout.flush()
            
            # Run the blocking indexing operation in thread pool
            loop = asyncio.get_event_loop()
            
            # Create a future for the indexing operation
            future = loop.run_in_executor(
                self.executor,
                self._perform_indexing,
                folder
            )
            
            # Wait for it to complete
            result = await future
            
            return result
            
        except Exception as e:
            print(json.dumps({
                "success": False,
                "action": "index",
                "status": "failed",
                "error": str(e)
            }), flush=True)
            raise
            
        finally:
            self.indexing_status["is_indexing"] = False
            self.indexing_status["progress"] = {}
            
    def _perform_indexing(self, folder: str) -> Dict[str, Any]:
        """Blocking indexing operation - runs in thread pool"""
        # This will still emit progress updates to stdout
        self.search_engine.index_directory_incremental(folder)
        
        # Ensure all output is flushed
        sys.stdout.flush()
        
        # Get statistics after indexing
        stats = self.search_engine.indexer.get_statistics()
        return {
            "documents": stats.get("total_documents", 0),
            "chunks": stats.get("total_chunks", 0)
        }
        
    async def handle_stats(self) -> Dict[str, Any]:
        """Get index statistics"""
        if not self.search_engine:
            return {"success": False, "error": "Engine not initialized"}
            
        try:
            stats = await asyncio.get_event_loop().run_in_executor(
                self.executor,
                self.search_engine.indexer.get_statistics
            )
            
            return {
                "success": True,
                "action": "stats",
                "stats": {
                    "total_documents": stats.get("total_documents", 0),
                    "total_chunks": stats.get("total_chunks", 0),
                    "index_size": stats.get("index_size", 0),
                    "embedding_dimension": stats.get("embedding_dimension", 0),
                    "created_at": stats.get("created_at"),
                    "last_updated": stats.get("last_updated")
                }
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
            
    async def handle_status(self) -> Dict[str, Any]:
        """Get current indexing status"""
        return {
            "success": True,
            "action": "status",
            "is_indexing": self.indexing_status["is_indexing"],
            "progress": self.indexing_status["progress"]
        }
        
    async def handle_clear(self) -> Dict[str, Any]:
        """Clear the index"""
        if self.indexing_status["is_indexing"]:
            return {"success": False, "error": "Cannot clear during indexing"}
            
        try:
            await asyncio.get_event_loop().run_in_executor(
                self.executor,
                self.search_engine.clear_index
            )
            return {"success": True, "action": "clear"}
        except Exception as e:
            return {"success": False, "error": str(e)}
            
    async def process_command(self, line: str) -> Optional[Dict[str, Any]]:
        """Process a single command"""
        try:
            command = json.loads(line.strip())
            action = command.get("action")
            
            if action == "search":
                return await self.handle_search(
                    command.get("query", ""),
                    command.get("limit", 10)
                )
            elif action == "index":
                return await self.handle_index(command.get("folder"))
            elif action == "stats":
                return await self.handle_stats()
            elif action == "status":
                return await self.handle_status()
            elif action == "clear":
                return await self.handle_clear()
            elif action == "exit":
                self.should_exit = True
                return {"success": True, "action": "exit"}
            else:
                return {"success": False, "error": f"Unknown action: {action}"}
                
        except json.JSONDecodeError as e:
            return {"success": False, "error": f"Invalid JSON: {e}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
            
    async def read_stdin(self):
        """Async stdin reader"""
        loop = asyncio.get_event_loop()
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await loop.connect_read_pipe(lambda: protocol, sys.stdin)
        return reader
    
    def check_parent_alive(self):
        """Check if parent process is still running"""
        try:
            # On Unix, sending signal 0 checks if process exists
            os.kill(self.parent_pid, 0)
            return True
        except (OSError, ProcessLookupError):
            return False
        
    async def run(self):
        """Main async run loop"""
        # Initialize search engine
        await self.initialize()
        
        # Set up async stdin reader
        reader = await self.read_stdin()
        
        print(json.dumps({"status": "ready"}), flush=True)
        
        # Process commands
        while not self.should_exit:
            try:
                # Read line with timeout to check exit flag periodically
                line_bytes = await asyncio.wait_for(
                    reader.readline(),
                    timeout=1.0
                )
                
                if not line_bytes:
                    break
                    
                line = line_bytes.decode('utf-8').strip()
                if not line:
                    continue
                    
                # Process command
                result = await self.process_command(line)
                if result:
                    # Ensure all buffered output is flushed before sending the final result
                    sys.stdout.flush()
                    sys.stderr.flush()
                    print(json.dumps(result), flush=True)
                    sys.stdout.flush()
                    
            except asyncio.TimeoutError:
                # Check if parent process is still alive
                if not self.check_parent_alive():
                    print(json.dumps({"status": "parent_died", "message": "Parent process terminated"}), flush=True)
                    self.should_exit = True
                    break
                # Check if we should exit
                continue
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(json.dumps({
                    "success": False,
                    "error": f"Unexpected error: {e}"
                }), flush=True)
                
        # Clean up
        if self.indexing_task and not self.indexing_task.done():
            self.indexing_task.cancel()
            try:
                await self.indexing_task
            except asyncio.CancelledError:
                pass
                
        self.executor.shutdown(wait=True)
        

def main():
    """Main entry point"""
    # Handle signals gracefully
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    cli = AsyncSearchCLI()
    
    def signal_handler(sig, frame):
        cli.should_exit = True
        
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        loop.run_until_complete(cli.run())
    finally:
        loop.close()
        

if __name__ == "__main__":
    main()