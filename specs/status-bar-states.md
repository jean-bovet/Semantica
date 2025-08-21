# Status Bar State Examples

## Design Requirements
- **Always Visible**: Status bar is permanent at bottom of window
- **Filename Only**: Display just filename, not full path
- **Single Operation**: Only one indexing operation at a time

## Different States of the Status Bar

### 1. Initial State (No Index)
```
├─────────────────────────────────────────────────────────────────┤
│ 🔍 No index - Click 'Index Folder' to start                    │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Indexing in Progress (Filename Only)
```
├─────────────────────────────────────────────────────────────────┤
│ 🔄 Indexing: Document.pdf  [████████░░░░] 42/100  [Cancel]     │
└─────────────────────────────────────────────────────────────────┘
```
Note: Shows only "Document.pdf" not "/Users/name/Documents/Document.pdf"

### 3. Ready State (Index Complete)
```
├─────────────────────────────────────────────────────────────────┤
│ ✅ Ready to search                      156 documents indexed   │
└─────────────────────────────────────────────────────────────────┘
```

### 4. Searching While Indexing
```
┌─────────────────────────────────────────────────────────────────┐
│  [Searching: "machine learning"...]                            │
│                                                                 │
│  📄 Result 1 (from existing index)                            │
│  📄 Result 2 (from existing index)                            │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ 🔄 Indexing: NewDoc.pdf  [██████████░░] 85/100  [Cancel]      │
└─────────────────────────────────────────────────────────────────┘
```

### 5. Error State
```
├─────────────────────────────────────────────────────────────────┤
│ ⚠️ Error: Failed to index folder - Permission denied           │
└─────────────────────────────────────────────────────────────────┘
```

### 6. Indexing Cancelled
```
├─────────────────────────────────────────────────────────────────┤
│ ⚠️ Indexing cancelled                   42 documents indexed    │
└─────────────────────────────────────────────────────────────────┘
```

### 7. Re-indexing Same Folder (Incremental)
```
├─────────────────────────────────────────────────────────────────┤
│ 🔄 Indexing: NewFile.pdf  [██████████░░] 3/5 (5 new files)     │
└─────────────────────────────────────────────────────────────────┘
```
Note: When re-indexing, only new/modified files are processed

### 8. New Folder Replaces Current Indexing
```
Before:
├─────────────────────────────────────────────────────────────────┤
│ 🔄 Indexing: OldFolder/file.pdf  [████░░░░] 40/100  [Cancel]   │
└─────────────────────────────────────────────────────────────────┘

User selects new folder → Previous indexing cancelled automatically

After:
├─────────────────────────────────────────────────────────────────┤
│ 🔄 Indexing: NewFolder/doc.pdf  [██░░░░░░░░] 1/50  [Cancel]    │
└─────────────────────────────────────────────────────────────────┘
```

## Color Coding

- **Blue** (🔄): Indexing in progress
- **Green** (✅): Ready/Success
- **Yellow** (⚠️): Warning/Cancelled
- **Red** (❌): Error
- **Gray**: Idle/No index

## Animation Ideas

1. **Pulsing Icon**: The status icon pulses during indexing
2. **Progress Bar**: Smooth animation as files are processed
3. **Text Transition**: Fade between different file names
4. **Slide In/Out**: Status bar slides up when indexing starts

## User Interactions

1. **Hover on Progress**: Show tooltip with current file path
2. **Click on Error**: Show details in popover
3. **Click on Stats**: Open statistics window
4. **Double-click Status Bar**: Expand for more details

## Responsive Behavior

### Narrow Window (< 600px)
```
├────────────────────────────────────┤
│ 🔄 42/100 [████░░] [X]            │
└────────────────────────────────────┘
```

### Wide Window (> 1000px)
```
├──────────────────────────────────────────────────────────────────────────┤
│ 🔄 Indexing: /Users/name/Documents/ImportantDocument.pdf                │
│     Progress: [████████████░░░░░░░░] 42/100 files  Elapsed: 00:34  [Cancel] │
└──────────────────────────────────────────────────────────────────────────┘
```