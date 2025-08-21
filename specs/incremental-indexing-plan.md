# Incremental Indexing Implementation

## Overview
✅ **IMPLEMENTED** - Smart incremental indexing tracks file modifications and only re-indexes changed files, significantly speeding up subsequent indexing operations.

## Implementation Strategy

### 1. File Metadata Tracking
- Store file metadata (path, size, modification time, hash) in a SQLite database
- Track document-to-chunk mappings for efficient removal/updates
- Keep index of which FAISS vectors belong to which documents

### 2. Change Detection System
```python
FileMetadata:
  - file_path: str
  - file_size: int
  - modified_time: float
  - content_hash: str (optional, for deeper verification)
  - document_id: str
  - chunk_ids: List[str]
  - vector_indices: List[int]
```

### 3. Incremental Update Process

#### Scan Phase
Compare current files with stored metadata:
- **New files** → Add to indexing queue
- **Modified files** → Remove old chunks, add to indexing queue
- **Deleted files** → Remove from index
- **Unchanged files** → Skip

#### Update Phase
- Remove outdated vectors from FAISS index
- Process only changed files
- Add new vectors to FAISS index
- Update metadata database

### 4. Technical Components

#### A. Metadata Store (`metadata_store.py`)
- SQLite database for persistence
- Tables: `files`, `chunks`, `index_mappings`
- Methods: `get_file_status()`, `update_file()`, `remove_file()`

#### B. Index Manager Updates (`indexer.py`)
- Add vector tracking (which vectors belong to which document)
- Implement `remove_vectors()` method
- Support partial index updates

#### C. Document Processor Updates
- Add file change detection
- Return status (new/modified/unchanged)
- Batch process only changed files

### 5. UI/UX Enhancements
- Show "Checking for changes..." status
- Display counts: "5 new, 3 modified, 92 unchanged files"
- Progress bar shows only files being processed
- Option to force full re-index if needed

### 6. Benefits
- **Speed**: 10-100x faster for mostly unchanged folders
- **Efficiency**: Only process what changed
- **Scalability**: Handle large document sets better
- **User Experience**: Near-instant updates for small changes

### 7. Implementation Steps
1. Create metadata store module
2. Update indexer to track vector positions
3. Modify document processor for change detection
4. Update CLI to support incremental mode
5. Enhance UI to show change statistics
6. Add "Force Re-index" option

### 8. Potential Challenges
- FAISS doesn't natively support deletion (need workaround)
- Maintaining vector position mappings
- Handling file moves/renames
- Database synchronization with index

## Detailed Implementation

### Phase 1: Metadata Store

Create a new module `src/metadata_store.py`:

```python
class MetadataStore:
    def __init__(self, db_path: str):
        """Initialize SQLite database for metadata storage"""
        
    def initialize_db(self):
        """Create tables if they don't exist"""
        # files table: file_path, size, modified_time, document_id, hash
        # chunks table: chunk_id, document_id, vector_index
        # folders table: folder_path, last_indexed
        
    def get_file_status(self, file_path: str, current_stats: os.stat_result):
        """Check if file is new, modified, or unchanged"""
        
    def update_file(self, file_path: str, document_id: str, chunks: List[ChunkInfo]):
        """Update metadata for a file"""
        
    def remove_file(self, file_path: str):
        """Remove file and its chunks from metadata"""
        
    def get_changed_files(self, directory: str) -> ChangeSet:
        """Scan directory and return what changed"""
        # Returns: new_files, modified_files, deleted_files, unchanged_files
```

### Phase 2: FAISS Index Management

Update `src/indexer.py`:

```python
class FAISSIndexer:
    def __init__(self, ...):
        # Add document_to_vectors mapping
        self.doc_vector_map = {}  # document_id -> [vector_indices]
        
    def add_documents_incremental(self, chunks, embeddings, document_id):
        """Add new documents and track their vector positions"""
        
    def remove_document(self, document_id):
        """Mark vectors as deleted (soft delete)"""
        # FAISS doesn't support deletion, so we track deleted indices
        
    def compact_index(self):
        """Rebuild index without deleted vectors (when needed)"""
```

### Phase 3: Document Processor Integration

Update `src/document_processor.py`:

```python
class DocumentProcessor:
    def __init__(self, ..., metadata_store: MetadataStore = None):
        self.metadata_store = metadata_store
        
    def process_directory_incremental(self, directory_path: str):
        """Process only changed files in directory"""
        if not self.metadata_store:
            return self.process_directory(directory_path)
            
        change_set = self.metadata_store.get_changed_files(directory_path)
        
        # Report statistics
        if self.json_mode:
            print(json.dumps({
                "status": "change_detection",
                "new": len(change_set.new_files),
                "modified": len(change_set.modified_files),
                "deleted": len(change_set.deleted_files),
                "unchanged": len(change_set.unchanged_files)
            }))
        
        # Process only changed files
        files_to_process = change_set.new_files + change_set.modified_files
        # ... continue with processing
```

### Phase 4: CLI Integration

Update `cli.py`:

```python
@cli.command()
@click.option('--incremental/--full', default=True, help='Use incremental indexing')
def index(ctx, folder, incremental, ...):
    """Index documents with incremental support"""
    if incremental:
        search_engine.index_directory_incremental(folder)
    else:
        search_engine.index_directory(folder)
```

### Phase 5: UI Updates

Update SwiftUI views to show:
- Change detection progress
- Statistics about what will be indexed
- Option to force full re-index

## Expected Performance Improvements

| Scenario | Current Time | With Incremental | Improvement |
|----------|-------------|------------------|-------------|
| No changes | 60s | 2s | 30x |
| 1% changed | 60s | 5s | 12x |
| 10% changed | 60s | 10s | 6x |
| 50% changed | 60s | 32s | 2x |
| 100% changed | 60s | 62s | ~1x |

## Testing Strategy

1. **Unit Tests**: Test each component separately
2. **Integration Tests**: Test full incremental flow
3. **Edge Cases**:
   - File renamed but content unchanged
   - File moved to different directory
   - File modified then reverted
   - Corrupted metadata database
   - Index/metadata mismatch

## Rollout Plan

1. Implement metadata store with backward compatibility
2. Add incremental support as opt-in feature
3. Test with real-world document sets
4. Make incremental the default after validation
5. Add UI for managing incremental index state