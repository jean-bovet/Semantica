"""
Metadata store for tracking file changes and enabling incremental indexing.
"""
import os
import sqlite3
import json
import hashlib
from typing import List, Dict, Tuple, Optional, Set
from dataclasses import dataclass
from pathlib import Path
from datetime import datetime


@dataclass
class FileInfo:
    """Information about a file in the index"""
    file_path: str
    content_hash: Optional[str]
    file_size: int
    modified_time: float
    indexed_at: float
    document_id: Optional[str] = None
    
@dataclass
class ChangeSet:
    """Set of file changes detected in a directory"""
    new_files: List[Path]
    modified_files: List[Path]
    deleted_files: List[str]  # Store as strings since files may not exist
    unchanged_files: List[Path]


class MetadataStore:
    """Manages metadata about indexed files for incremental updates"""
    
    def __init__(self, db_path: str = "./data/index/metadata.db"):
        self.db_path = db_path
        self.connection = None
        self._ensure_db_directory()
        self._connect()
        self._initialize_db()
    
    def _ensure_db_directory(self):
        """Ensure the database directory exists"""
        db_dir = os.path.dirname(self.db_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
    
    def _connect(self):
        """Connect to the SQLite database"""
        self.connection = sqlite3.connect(self.db_path)
        self.connection.row_factory = sqlite3.Row
    
    def _initialize_db(self):
        """Create tables if they don't exist"""
        cursor = self.connection.cursor()
        
        # Files table - stores information about each indexed file
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS files (
                file_path TEXT PRIMARY KEY,
                file_size INTEGER NOT NULL,
                modified_time REAL NOT NULL,
                document_id TEXT NOT NULL,
                content_hash TEXT,
                indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Chunks table - maps chunks to documents and vector indices
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chunks (
                chunk_id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                vector_index INTEGER,
                FOREIGN KEY (document_id) REFERENCES files(document_id)
            )
        """)
        
        # Folders table - tracks which folders have been indexed
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS folders (
                folder_path TEXT PRIMARY KEY,
                last_indexed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_files INTEGER DEFAULT 0
            )
        """)
        
        # Create indices for better performance
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_document_id ON chunks(document_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_vector_index ON chunks(vector_index)")
        
        self.connection.commit()
    
    def get_file_status(self, file_path: str, content_hash: Optional[str] = None,
                       file_size: Optional[int] = None, 
                       modified_time: Optional[float] = None) -> Tuple[str, Optional[FileInfo]]:
        """
        Check if a file is new, modified, or unchanged.
        Returns: (status, existing_file_info)
        Status can be: 'new', 'modified', 'unchanged'
        """
        cursor = self.connection.cursor()
        result = cursor.execute(
            "SELECT * FROM files WHERE file_path = ?", (file_path,)
        ).fetchone()
        
        if not result:
            return 'new', None
        
        # If parameters are provided, use them; otherwise get from file system
        if file_size is not None and modified_time is not None:
            current_mtime = modified_time
            current_size = file_size
            current_hash = content_hash
        else:
            # Get current file stats
            try:
                stat = os.stat(file_path)
                current_mtime = stat.st_mtime
                current_size = stat.st_size
                current_hash = None
            except FileNotFoundError:
                return 'deleted', FileInfo(
                    file_path=result['file_path'],
                    file_size=result['file_size'],
                    modified_time=result['modified_time'],
                    document_id=result['document_id'],
                    content_hash=result['content_hash'],
                    indexed_at=result['indexed_at']
                )
        
        stored_info = FileInfo(
            file_path=result['file_path'],
            file_size=result['file_size'],
            modified_time=result['modified_time'],
            document_id=result['document_id'],
            content_hash=result['content_hash'],
            indexed_at=result['indexed_at']
        )
        
        # Check if file has been modified
        # Priority: content_hash > modified_time > file_size
        if current_hash is not None and stored_info.content_hash is not None:
            if current_hash != stored_info.content_hash:
                return 'modified', stored_info
        
        if current_mtime != stored_info.modified_time or current_size != stored_info.file_size:
            return 'modified', stored_info
        
        return 'unchanged', stored_info
    
    def add_file(self, file_path: str, content_hash: Optional[str], 
                 file_size: int, modified_time: float, 
                 document_id: Optional[str] = None):
        """Add or update file metadata (used for testing and manual entries)"""
        cursor = self.connection.cursor()
        
        if document_id is None:
            # Generate a document_id if not provided
            import uuid
            document_id = str(uuid.uuid4())
        
        cursor.execute("""
            INSERT OR REPLACE INTO files (file_path, file_size, modified_time, 
                                        document_id, content_hash, indexed_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (file_path, file_size, modified_time, document_id, content_hash))
        
        self.connection.commit()
        return document_id
    
    def update_file(self, file_path: str, document_id: str, 
                   chunk_ids: List[str], vector_indices: List[int]):
        """Update metadata for a file"""
        cursor = self.connection.cursor()
        
        # Get file stats
        stat = os.stat(file_path)
        
        # Remove old entries if file was modified
        cursor.execute("DELETE FROM chunks WHERE document_id IN (SELECT document_id FROM files WHERE file_path = ?)", (file_path,))
        
        # Update or insert file record
        cursor.execute("""
            INSERT OR REPLACE INTO files (file_path, file_size, modified_time, document_id, indexed_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (file_path, stat.st_size, stat.st_mtime, document_id))
        
        # Insert chunk records
        for chunk_id, vector_idx in zip(chunk_ids, vector_indices):
            cursor.execute("""
                INSERT INTO chunks (chunk_id, document_id, vector_index)
                VALUES (?, ?, ?)
            """, (chunk_id, document_id, vector_idx))
        
        self.connection.commit()
    
    def remove_file(self, file_path: str) -> Optional[str]:
        """
        Remove a file and its chunks from metadata.
        Returns the document_id if file existed, None otherwise.
        """
        cursor = self.connection.cursor()
        
        # Get document_id before deletion
        result = cursor.execute(
            "SELECT document_id FROM files WHERE file_path = ?", (file_path,)
        ).fetchone()
        
        if result:
            document_id = result['document_id']
            
            # Delete chunks
            cursor.execute("DELETE FROM chunks WHERE document_id = ?", (document_id,))
            
            # Delete file
            cursor.execute("DELETE FROM files WHERE file_path = ?", (file_path,))
            
            self.connection.commit()
            return document_id
        
        return None
    
    def get_document_vectors(self, document_id: str) -> List[int]:
        """Get all vector indices for a document"""
        cursor = self.connection.cursor()
        results = cursor.execute(
            "SELECT vector_index FROM chunks WHERE document_id = ? ORDER BY vector_index",
            (document_id,)
        ).fetchall()
        
        return [r['vector_index'] for r in results]
    
    def get_changed_files(self, directory: str, supported_extensions: set = None, text_filenames: set = None) -> ChangeSet:
        """
        Scan directory and return what changed since last index.
        """
        directory_path = Path(directory)
        
        # Get all current files in directory
        current_files = set()
        for file_path in directory_path.rglob("*"):
            if file_path.is_file():
                # Skip hidden directories
                if any(part.startswith('.') for part in file_path.parts):
                    continue
                # Filter by supported extensions if provided
                if supported_extensions:
                    if file_path.suffix.lower() not in supported_extensions:
                        # Also check for known text files without extensions
                        if text_filenames and file_path.name not in text_filenames:
                            continue
                current_files.add(str(file_path))
        
        # Get all previously indexed files in this directory
        cursor = self.connection.cursor()
        results = cursor.execute(
            "SELECT file_path FROM files WHERE file_path LIKE ?",
            (f"{directory}%",)
        ).fetchall()
        
        indexed_files = {r['file_path'] for r in results}
        
        # Categorize files
        new_files = []
        modified_files = []
        unchanged_files = []
        deleted_files = []
        
        # Check current files
        for file_path in current_files:
            status, _ = self.get_file_status(file_path)
            
            if status == 'new':
                new_files.append(Path(file_path))
            elif status == 'modified':
                modified_files.append(Path(file_path))
            elif status == 'unchanged':
                unchanged_files.append(Path(file_path))
        
        # Check for deleted files
        for indexed_path in indexed_files:
            if indexed_path not in current_files:
                deleted_files.append(indexed_path)
        
        return ChangeSet(
            new_files=new_files,
            modified_files=modified_files,
            deleted_files=deleted_files,
            unchanged_files=unchanged_files
        )
    
    def update_folder_stats(self, folder_path: str, total_files: int):
        """Update folder indexing statistics"""
        cursor = self.connection.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO folders (folder_path, last_indexed, total_files)
            VALUES (?, CURRENT_TIMESTAMP, ?)
        """, (folder_path, total_files))
        self.connection.commit()
    
    def get_statistics(self) -> Dict[str, any]:
        """Get overall statistics about the metadata store"""
        cursor = self.connection.cursor()
        
        stats = {}
        
        # Total files
        result = cursor.execute("SELECT COUNT(*) as count FROM files").fetchone()
        stats['total_files'] = result['count']
        
        # Total chunks
        result = cursor.execute("SELECT COUNT(*) as count FROM chunks").fetchone()
        stats['total_chunks'] = result['count']
        
        # Indexed folders
        results = cursor.execute("SELECT * FROM folders ORDER BY last_indexed DESC").fetchall()
        stats['indexed_folders'] = [
            {
                'path': r['folder_path'],
                'last_indexed': r['last_indexed'],
                'total_files': r['total_files']
            }
            for r in results
        ]
        
        return stats
    
    def clear_all(self):
        """Clear all metadata (used when clearing the index)"""
        cursor = self.connection.cursor()
        cursor.execute("DELETE FROM chunks")
        cursor.execute("DELETE FROM files")
        cursor.execute("DELETE FROM folders")
        self.connection.commit()
    
    def close(self):
        """Close the database connection"""
        if self.connection:
            self.connection.close()
    
    def __del__(self):
        """Ensure connection is closed on deletion"""
        try:
            if hasattr(self, 'connection') and self.connection:
                self.connection.close()
        except (sqlite3.ProgrammingError, AttributeError):
            # Ignore thread safety and attribute errors during cleanup
            pass


if __name__ == "__main__":
    # Test the metadata store
    store = MetadataStore("./test_metadata.db")
    
    # Test file status
    test_file = __file__
    status, info = store.get_file_status(test_file)
    print(f"Status of {test_file}: {status}")
    
    # Test updating a file
    store.update_file(
        test_file, 
        "doc_123",
        ["chunk_1", "chunk_2", "chunk_3"],
        [0, 1, 2]
    )
    
    # Check status again
    status, info = store.get_file_status(test_file)
    print(f"Status after update: {status}")
    if info:
        print(f"  Document ID: {info.document_id}")
    
    # Get statistics
    stats = store.get_statistics()
    print(f"Statistics: {json.dumps(stats, indent=2)}")
    
    # Clean up test database
    os.remove("./test_metadata.db")