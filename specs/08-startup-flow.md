# App Startup Flow

*Previous: [07-signing-distribution.md](./07-signing-distribution.md)*

---

## Complete Flow from Startup to Ready

```mermaid
graph TD
    Start([App Starts]) --> MainProcess[Main Process: main.ts]
    
    MainProcess --> CreateWindow[Create Browser Window]
    MainProcess --> SpawnWorker[Spawn Worker Thread]
    
    CreateWindow --> LoadUI[Load React App]
    
    SpawnWorker --> InitWorker[Worker: Initialize DB]
    InitWorker --> WorkerReady[Worker Sends 'ready']
    
    LoadUI --> AppComponent[App.tsx Component Mounts]
    
    AppComponent --> CheckModel{Check Model Exists?}
    
    CheckModel -->|API Call| WorkerCheck[Worker: checkModelExists]
    WorkerCheck --> FileCheck[Check File System:<br/>/Library/.../models/.../model_quantized.onnx]
    
    FileCheck -->|Exists| ModelReady[Set modelReady = true]
    FileCheck -->|Not Found| StartDownload[Start Download Flow]
    
    ModelReady --> HideOverlay[Hide Loading Overlay]
    HideOverlay --> ShowMainUI[Show Search UI]
    
    StartDownload --> ShowDownloadUI[Show Download Progress Overlay]
    StartDownload --> WorkerDownload[Worker: downloadModel]
    
    WorkerDownload --> PauseQueue[Pause File Processing Queue]
    WorkerDownload --> CreateEmbedder[Create IsolatedEmbedder Singleton]
    
    CreateEmbedder --> SpawnChild[Spawn Child Process:<br/>embedder.child.cjs]
    
    SpawnChild --> InitTransformers[Initialize Transformers.js]
    InitTransformers --> SetupCache[Setup Model Cache Path:<br/>/Library/.../models/]
    
    SetupCache --> CreatePipeline[Create Feature Extraction Pipeline]
    CreatePipeline --> DownloadFiles[Download Model Files]
    
    DownloadFiles --> Download1[Download tokenizer.json<br/>~17MB]
    DownloadFiles --> Download2[Download config.json<br/>~1KB]
    DownloadFiles --> Download3[Download model_quantized.onnx<br/>~118MB]
    
    Download1 --> Progress1[Send Progress Updates]
    Download2 --> Progress2[Send Progress Updates]
    Download3 --> Progress3[Send Progress Updates]
    
    Progress1 --> UIUpdate[Update UI Progress Bar]
    Progress2 --> UIUpdate
    Progress3 --> UIUpdate
    
    Download3 --> VerifyModel[Verify Model File Exists]
    VerifyModel --> SendReady[Child Sends 'ready']
    
    SendReady --> EmbedderReady[Embedder Ready]
    EmbedderReady --> ResumeQueue[Resume File Processing]
    EmbedderReady --> CompleteSignal[Send 'download:complete']
    
    CompleteSignal --> ModelReady2[Set modelReady = true]
    ModelReady2 --> HideOverlay
    
    ShowMainUI --> ProcessFiles[Background: Process File Queue]
    ProcessFiles --> CheckModelLoop{Model Exists?}
    CheckModelLoop -->|No| Wait[Wait 1 second]
    Wait --> CheckModelLoop
    CheckModelLoop -->|Yes| ProcessFile[Process Next File]
    
    ProcessFile --> ParseFile[Parse Document]
    ParseFile --> ChunkText[Chunk Text]
    ChunkText --> EmbedText[Embed Chunks]
    
    EmbedText --> EmbedderPool{Pool Ready?}
    EmbedderPool -->|No| InitPool[Initialize Pool]
    InitPool --> EmbedderPool
    EmbedderPool -->|Yes| RoundRobin[Select Next Embedder]
    RoundRobin --> SendToChild[Send to Child Process]
    
    SendToChild --> RunModel[Run ML Model]
    RunModel --> ReturnVectors[Return Vectors]
    ReturnVectors --> SaveToDB[Save to LanceDB]
    SaveToDB --> NextFile[Process Next File]
    NextFile --> ProcessFiles
    
    style Start fill:#e1f5e1
    style ShowMainUI fill:#e1f5e1
    style ModelReady fill:#e1f5e1
    style ModelReady2 fill:#e1f5e1
    style StartDownload fill:#ffe0b2
    style ShowDownloadUI fill:#ffe0b2
    style DownloadFiles fill:#ffccbc
    style CheckModel fill:#fff3e0
    style FileCheck fill:#fff3e0
    style CheckModelLoop fill:#fff3e0
```

## Key Components

### 1. **Main Process** (`src/main/main.ts`)
- Creates Electron window
- Spawns worker thread
- Handles IPC communication
- Routes messages between renderer and worker

### 2. **Renderer Process** (`src/renderer/App.tsx`)
- Shows UI (search interface)
- Displays loading overlay during model check
- Shows download progress if model missing
- Removes overlay when ready

### 3. **Worker Thread** (`src/main/worker/index.ts`)
- Manages database (LanceDB)
- Handles file processing queue
- Downloads model files using sequential downloader
- **KEY**: Won't process files until model exists
- Initializes EmbedderPool after model ready

### 4. **EmbedderPool** (`src/shared/embeddings/embedder-pool.ts`)
- Manages pool of embedder processes (default: 2)
- Round-robin distribution of work
- Automatic health checks and recovery
- Mutex-protected restart operations

### 5. **Isolated Embedder** (`src/shared/embeddings/isolated.ts`)
- Individual embedder process manager
- Spawns child process for embeddings
- Memory monitoring (300MB RSS limit)
- Auto-restart after 5000 files or memory threshold

### 6. **Embedder Child Process** (`src/main/worker/embedder.child.ts`)
- Runs Transformers.js
- Loads model from cache (downloaded by worker)
- Performs actual embeddings
- Isolated to prevent memory leaks

## Critical Flows

### First-Time User (No Model)
1. App starts → Check model → Not found
2. Show download overlay with progress
3. Download ~136MB of model files
4. Verify download → Hide overlay
5. Show main UI → Start indexing

### Returning User (Model Exists)
1. App starts → Check model → Found
2. Brief "Loading..." overlay (< 1 second)
3. Hide overlay → Show main UI
4. Background indexing continues

### File Processing
- Queue waits for model to exist
- Checks every 1 second until ready
- Once ready, processes files continuously
- Each file: Parse → Chunk → Embed → Save

## Important Notes

1. **Singleton Pattern**: Only ONE embedder instance exists globally
2. **Queue Blocking**: File processing blocked until model ready
3. **Progress Updates**: Download progress forwarded through Worker → Main → Renderer
4. **Memory Management**: Child process restarts after ~500 files
5. **Model Location**: `/Users/[user]/Library/Application Support/Semantica/models/`

## Error Handling

- Model check fails → Retry once after 1 second
- Download fails → Show error with retry button
- Child process crashes → Auto-restart
- Worker crashes → Main process restarts it