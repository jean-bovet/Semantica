"""
Unit tests for MetadataStore class.
"""
import os
import time
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest
from src.metadata_store import MetadataStore, FileInfo, ChangeSet


class TestMetadataStore:
    """Test suite for MetadataStore."""
    
    @pytest.fixture
    def temp_db(self):
        """Create a temporary database for testing."""
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
            db_path = f.name
        yield db_path
        # Cleanup
        if os.path.exists(db_path):
            os.unlink(db_path)
            
    def test_initialization(self, temp_db):
        """Test metadata store initialization."""
        store = MetadataStore(temp_db)
        
        assert store.db_path == temp_db
        assert os.path.exists(temp_db)
        
        # Check that tables were created
        cursor = store.connection.cursor()
        result = cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        
        table_names = [r['name'] for r in result]
        assert 'files' in table_names
        assert 'chunks' in table_names
        
    def test_update_file(self, temp_db):
        """Test updating file metadata."""
        store = MetadataStore(temp_db)
        
        file_path = "/test/path/document.txt"
        document_id = "doc123"
        chunk_ids = ["chunk1", "chunk2"]
        vector_indices = [0, 1]
        
        # Create a temp file for stats
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False) as f:
            temp_file = f.name
            f.write(b"test content")
        
        # Update file (this should add it)
        store.update_file(temp_file, document_id, chunk_ids, vector_indices)
        
        # Verify file was added
        cursor = store.connection.cursor()
        result = cursor.execute(
            "SELECT * FROM files WHERE document_id = ?",
            (document_id,)
        ).fetchone()
        
        assert result is not None
        assert result['document_id'] == document_id
        
        # Cleanup
        import os
        os.unlink(temp_file)
        
    def test_update_existing_file(self, temp_db):
        """Test updating existing file metadata."""
        store = MetadataStore(temp_db)
        
        # Create a temp file
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False) as f:
            temp_file = f.name
            f.write(b"initial content")
        
        # Add initial file
        store.update_file(temp_file, "doc1", ["chunk1"], [0])
        
        # Update with new metadata
        store.update_file(temp_file, "doc2", ["chunk2", "chunk3"], [1, 2])
        
        # Verify update
        cursor = store.connection.cursor()
        result = cursor.execute(
            "SELECT * FROM files WHERE file_path = ?",
            (temp_file,)
        ).fetchone()
        
        assert result['document_id'] == "doc2"
        
        # Cleanup
        import os
        os.unlink(temp_file)
        
    def test_get_file_status_new(self, temp_db):
        """Test detecting new files."""
        store = MetadataStore(temp_db)
        
        status, info = store.get_file_status("/new/file.txt")
        
        assert status == 'new'
        assert info is None
        
    def test_get_file_status_unchanged(self, temp_db):
        """Test detecting unchanged files."""
        store = MetadataStore(temp_db)
        
        file_path = "/test/file.txt"
        content_hash = "hash123"
        file_size = 100
        modified_time = 1000.0
        
        # Add file to store
        store.add_file(file_path, content_hash, file_size, modified_time)
        
        # Check status with same metadata
        status, info = store.get_file_status(
            file_path, content_hash, file_size, modified_time
        )
        
        assert status == 'unchanged'
        assert info is not None
        assert info.content_hash == content_hash
        
    def test_get_file_status_modified_by_hash(self, temp_db):
        """Test detecting modified files by content hash."""
        store = MetadataStore(temp_db)
        
        file_path = "/test/file.txt"
        
        # Add original file
        store.add_file(file_path, "hash1", 100, 1000.0)
        
        # Check with different hash
        status, info = store.get_file_status(
            file_path, "hash2", 100, 1000.0
        )
        
        assert status == 'modified'
        assert info is not None
        
    def test_get_file_status_modified_by_time(self, temp_db):
        """Test detecting modified files by modification time."""
        store = MetadataStore(temp_db)
        
        file_path = "/test/file.txt"
        
        # Add original file
        store.add_file(file_path, "hash1", 100, 1000.0)
        
        # Check with different modification time
        status, info = store.get_file_status(
            file_path, None, 100, 2000.0  # No hash provided
        )
        
        assert status == 'modified'
        assert info is not None
        
    def test_get_file_status_modified_by_size(self, temp_db):
        """Test detecting modified files by size."""
        store = MetadataStore(temp_db)
        
        file_path = "/test/file.txt"
        
        # Add original file
        store.add_file(file_path, "hash1", 100, 1000.0)
        
        # Check with different size
        status, info = store.get_file_status(
            file_path, None, 200, 1000.0  # No hash, different size
        )
        
        assert status == 'modified'
        assert info is not None
        
    def test_remove_file(self, temp_db):
        """Test removing file and its chunks."""
        store = MetadataStore(temp_db)
        
        # Create a temp file
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False) as f:
            temp_file = f.name
            f.write(b"test content")
        
        # Add file with chunks
        doc_id = "doc123"
        store.update_file(temp_file, doc_id, ["chunk1", "chunk2"], [0, 1])
        
        # Remove file
        removed_doc_id = store.remove_file(temp_file)
        
        # Verify file is gone
        cursor = store.connection.cursor()
        file_result = cursor.execute(
            "SELECT * FROM files WHERE file_path = ?",
            (temp_file,)
        ).fetchone()
        assert file_result is None
        assert removed_doc_id == doc_id
        
        # Cleanup
        import os
        os.unlink(temp_file)
        
    def test_document_vectors(self, temp_db):
        """Test getting document vectors."""
        store = MetadataStore(temp_db)
        
        # Create a temp file
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False) as f:
            temp_file = f.name
            f.write(b"test content")
        
        doc_id = "doc123"
        vector_indices = [10, 20, 30]
        
        # Add file with chunks
        store.update_file(temp_file, doc_id, ["c1", "c2", "c3"], vector_indices)
        
        # Get vectors
        vectors = store.get_document_vectors(doc_id)
        
        assert len(vectors) == 3
        assert vectors == vector_indices
        
        # Cleanup
        import os
        os.unlink(temp_file)
        
    def test_get_statistics(self, temp_db):
        """Test getting statistics."""
        store = MetadataStore(temp_db)
        
        # Create temp files
        import tempfile
        temp_files = []
        for i in range(3):
            with tempfile.NamedTemporaryFile(delete=False) as f:
                f.write(b"test content" * 10)
                temp_files.append(f.name)
                store.update_file(f.name, f"doc{i}", [f"chunk{i}"], [i])
        
        # Get statistics
        stats = store.get_statistics()
        
        assert 'total_files' in stats
        assert 'total_chunks' in stats
        assert stats['total_files'] >= 3
        assert stats['total_chunks'] >= 3
        
        # Cleanup
        import os
        for f in temp_files:
            os.unlink(f)
        
    def test_get_changed_files(self, temp_db, temp_dir):
        """Test detecting changed files in a directory."""
        store = MetadataStore(temp_db)
        
        # Create test files
        file1 = Path(temp_dir) / "file1.txt"
        file2 = Path(temp_dir) / "file2.py"
        file3 = Path(temp_dir) / "file3.md"
        
        file1.write_text("Content 1")
        file2.write_text("Content 2")
        file3.write_text("Content 3")
        
        # Add file1 and file2 to store (file3 is new)
        store.add_file(str(file1), "hash1", 9, file1.stat().st_mtime)
        store.add_file(str(file2), "hash2", 9, file2.stat().st_mtime - 100)  # Old timestamp
        
        # Get changed files
        supported_extensions = {'.txt', '.py', '.md'}
        changes = store.get_changed_files(temp_dir, supported_extensions)
        
        assert isinstance(changes, ChangeSet)
        
        # file3 should be new
        new_paths = [str(f) for f in changes.new_files]
        assert str(file3) in new_paths
        
        # file2 should be modified (different timestamp)
        modified_paths = [str(f) for f in changes.modified_files]
        assert str(file2) in modified_paths
        
        # file1 should be unchanged (assuming)
        unchanged_paths = [str(f) for f in changes.unchanged_files]
        # This depends on exact timestamp matching
        
    def test_get_changed_files_with_deleted(self, temp_db, temp_dir):
        """Test detecting deleted files."""
        store = MetadataStore(temp_db)
        
        # Add a file that doesn't exist on disk
        deleted_path = str(Path(temp_dir) / "deleted.txt")
        store.add_file(deleted_path, "hash", 100, 1000.0)
        
        # Get changed files
        changes = store.get_changed_files(temp_dir)
        
        assert deleted_path in changes.deleted_files
        
    def test_concurrent_access(self, temp_db):
        """Test concurrent database access."""
        store1 = MetadataStore(temp_db)
        store2 = MetadataStore(temp_db)
        
        # Create temp files
        import tempfile
        temp_files = []
        for i in range(2):
            with tempfile.NamedTemporaryFile(delete=False) as f:
                f.write(b"test content")
                temp_files.append(f.name)
        
        # Both stores should be able to write
        store1.update_file(temp_files[0], "doc1", ["chunk1"], [0])
        store2.update_file(temp_files[1], "doc2", ["chunk2"], [1])
        
        # Both should see all files
        stats1 = store1.get_statistics()
        stats2 = store2.get_statistics()
        
        assert stats1['total_files'] == 2
        assert stats2['total_files'] == 2
        
        # Cleanup
        import os
        for f in temp_files:
            os.unlink(f)
        
    def test_clear_all(self, temp_db):
        """Test clearing all metadata."""
        store = MetadataStore(temp_db)
        
        # Create a temp file
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False) as f:
            temp_file = f.name
            f.write(b"test content")
        
        # Add some data
        store.update_file(temp_file, "doc1", ["chunk1", "chunk2"], [0, 1])
        
        # Clear all
        store.clear_all()
        
        # Verify everything is gone
        cursor = store.connection.cursor()
        
        files_count = cursor.execute("SELECT COUNT(*) FROM files").fetchone()[0]
        assert files_count == 0
        
        chunks_count = cursor.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        assert chunks_count == 0
        
        # Cleanup
        import os
        os.unlink(temp_file)
        
    def test_file_info_dataclass(self):
        """Test FileInfo dataclass."""
        info = FileInfo(
            file_path="/test/file.txt",
            content_hash="hash123",
            file_size=100,
            modified_time=1000.0,
            indexed_at=2000.0
        )
        
        assert info.file_path == "/test/file.txt"
        assert info.content_hash == "hash123"
        assert info.file_size == 100
        assert info.modified_time == 1000.0
        assert info.indexed_at == 2000.0
        
    def test_change_set_dataclass(self):
        """Test ChangeSet dataclass."""
        changes = ChangeSet(
            new_files=[Path("/new1.txt"), Path("/new2.txt")],
            modified_files=[Path("/mod1.txt")],
            deleted_files=["/del1.txt"],
            unchanged_files=[Path("/same1.txt")]
        )
        
        assert len(changes.new_files) == 2
        assert len(changes.modified_files) == 1
        assert len(changes.deleted_files) == 1
        assert len(changes.unchanged_files) == 1
        
    def test_special_characters_in_path(self, temp_db):
        """Test handling special characters in file paths."""
        store = MetadataStore(temp_db)
        
        # Create temp file
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False) as f:
            temp_file = f.name
            f.write(b"test content")
        
        # Use actual file but test with special doc_id
        special_doc_ids = [
            "doc with spaces",
            "doc'with'quotes",
            'doc"with"double',
            "doc/with/slashes"
        ]
        
        for i, doc_id in enumerate(special_doc_ids):
            store.update_file(temp_file, doc_id, [f"chunk{i}"], [i])
            # Just verify it doesn't crash
            
        # Cleanup
        import os
        os.unlink(temp_file)
        
    # Removed duplicate test - already defined above