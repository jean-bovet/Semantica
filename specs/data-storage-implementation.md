# Data Storage Implementation - COMPLETED

> **Status**: ✅ Implemented and tested
> **Date**: August 2024

## Current Problem

The search index, metadata, and embeddings cache are currently stored in relative paths (`./data/index/`), which means:

1. **Data stored in app bundle** - When running from Xcode, data goes to `/Users/bovet/Library/Developer/Xcode/DerivedData/.../Build/Products/Debug/FinderSemanticSearch.app/Contents/Resources/python_cli/data/`
2. **Data lost on rebuild** - Every Xcode rebuild wipes the index
3. **Data lost on app update** - App updates will destroy user's indexed data
4. **Violates macOS guidelines** - App bundles should be read-only
5. **No data persistence** - Users lose their entire index when the app is deleted/reinstalled

## Proposed Solution

Move all persistent data to the proper macOS user Library locations following Apple's guidelines.

### Directory Structure

```
~/Library/Application Support/FinderSemanticSearch/
├── venv/                    # ✅ Already implemented
│   ├── bin/
│   ├── lib/
│   └── deps_installed.txt
├── data/
│   ├── index/              # 🔧 Need to move here
│   │   ├── faiss.index
│   │   ├── metadata.json
│   │   ├── metadata.db
│   │   ├── chunks.pkl
│   │   └── index_config.json
│   └── embeddings_cache/   # 🔧 Need to move here
│       └── *.pkl
└── config.yaml             # 🔧 User configuration

~/Library/Caches/FinderSemanticSearch/
└── models/                 # 🔧 Downloaded ML models (can be re-downloaded)
    └── sentence-transformers/
```

### Rationale for Locations

1. **Application Support** (`~/Library/Application Support/`)
   - User data that should persist across app updates
   - Index files, metadata, configuration
   - Already using for venv (good precedent)

2. **Caches** (`~/Library/Caches/`)
   - Data that can be regenerated if deleted
   - Downloaded ML models
   - Temporary processing files

3. **Never use**:
   - `~/Documents/` - User-visible files only
   - App bundle - Should be read-only
   - `/tmp/` - Gets cleared on reboot

## Implementation Plan

### Phase 1: Update Python CLI Path Resolution

**1.1 Create Path Helper Module** (`src/paths.py`)
```python
from pathlib import Path
import os

def get_app_support_dir() -> Path:
    """Get Application Support directory for the app"""
    home = Path.home()
    app_support = home / "Library" / "Application Support" / "FinderSemanticSearch"
    app_support.mkdir(parents=True, exist_ok=True)
    return app_support

def get_data_dir() -> Path:
    """Get data directory for persistent storage"""
    data_dir = get_app_support_dir() / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir

def get_index_dir() -> Path:
    """Get index directory"""
    index_dir = get_data_dir() / "index"
    index_dir.mkdir(parents=True, exist_ok=True)
    return index_dir

def get_embeddings_cache_dir() -> Path:
    """Get embeddings cache directory"""
    cache_dir = get_data_dir() / "embeddings_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir

def get_config_path() -> Path:
    """Get user config file path"""
    return get_app_support_dir() / "config.yaml"

def get_cache_dir() -> Path:
    """Get cache directory for downloadable content"""
    home = Path.home()
    cache = home / "Library" / "Caches" / "FinderSemanticSearch"
    cache.mkdir(parents=True, exist_ok=True)
    return cache
```

**1.2 Update Search Engine Initialization**
```python
# src/search.py
from paths import get_index_dir, get_embeddings_cache_dir

class DocumentSearchEngine:
    def __init__(self, 
                 index_dir: Optional[str] = None,  # Allow override
                 ...):
        
        # Use Application Support by default
        if index_dir is None:
            index_dir = str(get_index_dir())
        
        self.index_dir = index_dir
        ...
```

**1.3 Update Embeddings Generator**
```python
# src/embeddings.py
from paths import get_embeddings_cache_dir

class EmbeddingGenerator:
    def __init__(self, 
                 cache_dir: Optional[str] = None,
                 ...):
        
        if cache_dir is None:
            cache_dir = str(get_embeddings_cache_dir())
        
        self.cache_dir = Path(cache_dir)
        ...
```

**1.4 Update Metadata Store**
```python
# src/metadata_store.py
from paths import get_index_dir

class MetadataStore:
    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            db_path = str(get_index_dir() / "metadata.db")
        ...
```

### Phase 2: Update CLI Initialization

**2.1 Update CLI Startup**
```python
# cli.py
async def initialize(self):
    # Initialize with new paths (will use Application Support by default)
    self.search_engine = DocumentSearchEngine(
        json_mode=True,
        # index_dir will default to Application Support
    )
```

### Phase 3: Configuration Management

**3.1 Update Config Loading**
```python
# src/config.py
from paths import get_config_path

def load_config():
    config_path = get_config_path()
    
    if not config_path.exists():
        # Copy default config
        default_config = Path(__file__).parent.parent / "config.yaml"
        if default_config.exists():
            shutil.copy(default_config, config_path)
    
    with open(config_path) as f:
        return yaml.safe_load(f)
```

### Phase 4: Swift Side Updates

**4.1 Remove Working Directory Setting**
```swift
// PythonCLIBridge.swift
// Remove this line - let Python determine its own paths
// process?.currentDirectoryURL = URL(fileURLWithPath: standaloneCliPath).deletingLastPathComponent()
```

**4.2 Add Path Information to UI**
```swift
// Show users where their data is stored
let dataPath = NSHomeDirectory() + "/Library/Application Support/FinderSemanticSearch/data"
```

### Phase 5: Cleanup & Testing

**5.1 Update .gitignore**
```
# Remove local data directory from git
data/
# Application Support test data
~/Library/Application Support/FinderSemanticSearch/
```

**5.2 Test Scenarios**
1. Fresh install - creates directories correctly
2. Existing data in Application Support - uses existing
3. Multiple index operations save to correct location
4. App rebuild doesn't affect stored data

## Benefits

1. **Data Persistence** - Survives app updates and rebuilds
2. **Proper macOS Compliance** - Follows Apple's directory guidelines
3. **User-Friendly** - Data in expected location for backups
4. **Multi-User Support** - Each user has their own index
5. **Clean Separation** - App bundle remains read-only
6. **Time Machine Friendly** - Application Support is backed up by default

## Risks & Mitigations

### Risk 1: Permission Issues
**Mitigation**: Application Support is user-writable by default. Use proper error handling.

### Risk 2: Disk Space
**Mitigation**: Check available space before operations. Provide cleanup tools.

### Risk 3: Existing Development Data Loss
**Mitigation**: Acceptable - developers will need to re-index, but production users get clean start.

## Implementation Timeline

1. **Day 1**: Implement path helper module and update Python components (3 hours)
2. **Day 1**: Update Swift side and test end-to-end (2 hours)
3. **Day 1**: Document changes and update README (1 hour)

**Total: 6 hours**

## Testing Checklist

- [ ] Fresh install creates directories correctly
- [ ] Search works with new paths
- [ ] Indexing saves to correct location
- [ ] Config file loads from Application Support
- [ ] Embeddings cache in correct location
- [ ] Xcode rebuild doesn't lose data
- [ ] App deletion preserves data in Library
- [ ] Multi-user setup works correctly
- [ ] Time Machine backs up the data

## User Communication

Add to release notes:
```
Data Storage Update:
Your search index is now stored in a permanent location that survives app updates.

Location: ~/Library/Application Support/FinderSemanticSearch/

Note: Existing development indexes will need to be recreated after this update.
```