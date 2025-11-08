# Security Review & Coding Pattern Analysis
**Date:** November 2025
**Reviewer:** AI Security Audit
**Scope:** Complete codebase review for security vulnerabilities and coding pattern improvements

---

## Executive Summary

This security review identified **10 security issues** across High, Medium, and Low severity categories, plus **8 coding pattern improvement areas**. The most critical findings are:

1. **XSS vulnerabilities** in search result rendering (HIGH SEVERITY)
2. **Unvalidated file path operations** in Python sidecar (HIGH SEVERITY)
3. **Missing input validation** for settings updates (HIGH SEVERITY)
4. **Shell API exposure** without path validation (MEDIUM SEVERITY)

The codebase demonstrates good security practices for an Electron application (context isolation, sandboxing, node integration disabled), but user-controlled content rendering and file system operations require immediate attention.

**Risk Assessment:** **MEDIUM** - Local-only single-user application reduces attack surface, but XSS and path traversal vulnerabilities could be exploited through malicious document content.

---

## Critical Security Findings

### 🔴 HIGH SEVERITY

#### 1. XSS via dangerouslySetInnerHTML in Search Components

**Files Affected:**
- `src/renderer/components/SearchResult.tsx:48`
- `src/renderer/components/DetailPanel.tsx:211, 221, 225`

**Vulnerability:**
User-indexed document content is rendered as HTML using `dangerouslySetInnerHTML` after regex-based highlighting. If indexed documents contain malicious HTML/JavaScript, it will execute in the renderer context.

**Attack Vector:**
```typescript
// Current vulnerable code (SearchResult.tsx:16-17)
const regex = new RegExp(`(${part})`, 'gi');
highlighted = highlighted.replace(regex, '<mark>$1</mark>');

// If result.text contains: <img src=x onerror="alert('xss')">
// This will be rendered as executable HTML
```

**Proof of Concept:**
1. Create a text file with content: `Hello <img src=x onerror="alert(document.cookie)">`
2. Index the file
3. Search for "Hello"
4. XSS executes when result is displayed

**Impact:**
- Arbitrary JavaScript execution in renderer context
- Access to window.api (IPC channels)
- Potential to trigger file system operations via exposed APIs
- Session hijacking (if cookies were used)

**Recommendation:**
Replace HTML injection with safe React patterns:

```typescript
// Safe highlighting approach
function SafeHighlight({ text, query }: { text: string; query: string }) {
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'));

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i}>{part}</mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

// Helper to escape regex special chars
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

**Priority:** CRITICAL - Fix immediately

---

#### 2. Path Traversal in Python Sidecar

**Files Affected:**
- `embedding_sidecar/embed_server.py:262, 315, 347`

**Vulnerability:**
File paths received from the client are used directly without normalization or validation. Symlinks and relative paths (../) could access files outside intended directories.

**Attack Vector:**
```python
# Current vulnerable code (embed_server.py:262-263)
path = req.path
if not os.path.exists(path):
    raise HTTPException(404, f"File not found: {path}")
text = extract_text(path)  # ← Directly opens any path
```

**Proof of Concept:**
1. Create symlink: `ln -s /etc/passwd ~/Documents/fakefile.txt`
2. Index ~/Documents
3. Application reads and embeds /etc/passwd content

**Impact:**
- Read arbitrary files on the system (limited by user permissions)
- Exposure of sensitive configuration files
- Potential for information disclosure through search results

**Recommendation:**
Add path validation and normalization:

```python
import os.path
from pathlib import Path

ALLOWED_DIRECTORIES = []  # Set from config

def validate_path(path: str) -> str:
    """Validate and normalize file path."""
    # Resolve symlinks and normalize
    real_path = os.path.realpath(path)

    # Check if within allowed directories
    if ALLOWED_DIRECTORIES:
        allowed = any(
            real_path.startswith(os.path.realpath(allowed_dir))
            for allowed_dir in ALLOWED_DIRECTORIES
        )
        if not allowed:
            raise HTTPException(403, "Path outside allowed directories")

    # Check file exists
    if not os.path.exists(real_path):
        raise HTTPException(404, f"File not found: {path}")

    return real_path

# Usage
@app.post("/embed-file")
async def embed_file(req: EmbedRequest):
    path = validate_path(req.path)
    text = extract_text(path)
    ...
```

**Additional Recommendation:**
Validate file type by MIME type, not just extension:

```python
import mimetypes

def validate_file_type(path: str) -> None:
    """Validate file is expected type."""
    mime_type, _ = mimetypes.guess_type(path)
    allowed_types = ['application/pdf', 'text/plain', 'text/markdown']

    if mime_type not in allowed_types:
        raise HTTPException(415, f"Unsupported file type: {mime_type}")
```

**Priority:** CRITICAL - Fix immediately

---

#### 3. Unvalidated Settings Update

**Files Affected:**
- `src/main/worker/config.ts:53-56`

**Vulnerability:**
Settings are merged directly from renderer without validation. Malicious or malformed settings could break application functionality or enable attacks.

**Attack Vector:**
```typescript
// Current vulnerable code (config.ts:54)
updateSettings(settings: Partial<AppConfig['settings']>): void {
  this.config.settings = { ...this.config.settings, ...settings };
  this.saveConfig(this.config);
}

// Renderer could send:
window.api.settings.update({
  excludePatterns: ['a'.repeat(1000000)],  // DoS via huge array
  embeddingBatchSize: -1,                   // Invalid value
  cpuThrottle: 'INVALID',                   // Wrong enum value
});
```

**Impact:**
- Application crash or instability
- Resource exhaustion (memory/CPU)
- Bypass of security settings (e.g., excludePatterns)

**Recommendation:**
Apply validation before saving:

```typescript
import { validateAndMigrateConfig } from '../../shared/config/configIO';

updateSettings(settings: Partial<AppConfig['settings']>): void {
  // Merge with current settings
  const newConfig = {
    ...this.config,
    settings: { ...this.config.settings, ...settings }
  };

  // Validate merged config
  const validated = validateAndMigrateConfig(newConfig);

  // Only save if valid
  this.config = validated;
  this.saveConfig(this.config);
}
```

**Priority:** HIGH - Fix before next release

---

#### 4. executeJavaScript Anti-Pattern

**Files Affected:**
- `src/main/main.ts:127`

**Vulnerability:**
Using `executeJavaScript` to send data to renderer. While currently safe (JSON.stringify escapes), this is an anti-pattern that could become vulnerable if payload structure changes.

**Current Code:**
```typescript
// main.ts:127
win?.webContents.executeJavaScript(`console.log(${JSON.stringify(msg.payload)})`);
```

**Risk:**
If `msg.payload` contains special characters or JSON.stringify fails, could execute arbitrary code.

**Recommendation:**
Use IPC messaging instead:

```typescript
// Replace executeJavaScript with IPC send
win?.webContents.send('pipeline:status', msg.payload);

// In renderer (preload.ts), add listener
window.api.on('pipeline:status', (data) => {
  console.log(data);
});
```

**Priority:** HIGH - Replace with safer pattern

---

### 🟡 MEDIUM SEVERITY

#### 5. Shell API Exposure Without Validation

**Files Affected:**
- `src/main/main.ts:398-408`

**Vulnerability:**
Shell APIs (`showItemInFolder`, `openExternal`, `openPath`) accept paths/URLs from renderer without validation.

**Attack Vector:**
```typescript
// Malicious renderer could call:
window.api.system.openExternal('file:///etc/passwd');
window.api.system.openPath('/System/Library/CoreServices/Applications/');
```

**Impact:**
- Open arbitrary files or applications
- Trigger phishing via external URLs
- UI confusion/spoofing

**Recommendation:**
Add validation:

```typescript
import { isAbsolute, normalize } from 'path';
import { URL } from 'url';

ipcMain.handle('system:openPath', async (_, filePath: string) => {
  // Validate path is absolute and normalized
  const normalizedPath = normalize(filePath);
  if (!isAbsolute(normalizedPath)) {
    throw new Error('Path must be absolute');
  }

  // Optional: Check path is within user's home directory or watched folders
  const allowedPaths = configManager.getWatchedFolders();
  const isAllowed = allowedPaths.some(allowed =>
    normalizedPath.startsWith(normalize(allowed))
  );

  if (!isAllowed) {
    // Show warning dialog
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      message: 'Open file outside watched folders?',
      detail: normalizedPath,
      buttons: ['Cancel', 'Open'],
      defaultId: 0
    });
    if (response !== 1) return;
  }

  shell.showItemInFolder(normalizedPath);
});

ipcMain.handle('system:openExternal', async (_, url: string) => {
  try {
    const parsed = new URL(url);

    // Only allow http(s) and mailto
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      throw new Error('Invalid protocol');
    }

    // Show confirmation dialog for external URLs
    const { response } = await dialog.showMessageBox({
      type: 'question',
      message: 'Open external URL?',
      detail: url,
      buttons: ['Cancel', 'Open'],
      defaultId: 0
    });

    if (response === 1) {
      await shell.openExternal(url);
    }
  } catch (err) {
    throw new Error('Invalid URL');
  }
});
```

**Priority:** MEDIUM - Add validation

---

#### 6. Dialog String Injection

**Files Affected:**
- `src/main/main.ts:450-455`

**Vulnerability:**
Dialog title and message strings from renderer are not sanitized, enabling UI spoofing.

**Attack Vector:**
```typescript
// Malicious renderer could spoof system dialogs:
window.api.dialog.error(
  'macOS Security Update',
  'Your system requires a security update. Click OK to install.'
);
```

**Impact:**
- UI spoofing
- Social engineering attacks
- User confusion

**Recommendation:**
Sanitize or use predefined templates:

```typescript
// Whitelist allowed dialog types
const DIALOG_TEMPLATES = {
  deleteConfirm: {
    title: 'Confirm Delete',
    messageTemplate: 'Delete {count} items?'
  },
  // ... other templates
} as const;

ipcMain.handle('dialog:show', async (_, type: string, params: Record<string, any>) => {
  const template = DIALOG_TEMPLATES[type as keyof typeof DIALOG_TEMPLATES];
  if (!template) {
    throw new Error('Invalid dialog type');
  }

  // Build message from template
  let message = template.messageTemplate;
  Object.entries(params).forEach(([key, value]) => {
    // Sanitize values - remove special chars
    const sanitized = String(value).replace(/[<>]/g, '');
    message = message.replace(`{${key}}`, sanitized);
  });

  return dialog.showMessageBox({
    type: 'question',
    title: template.title,
    message: message,
    buttons: ['Cancel', 'OK']
  });
});
```

**Priority:** MEDIUM - Implement template system

---

#### 7. Query String DoS Risk

**Files Affected:**
- `src/main/worker/index.ts:1165`
- `src/renderer/hooks/useSearch.ts:21`

**Vulnerability:**
Search queries have no length validation. Extremely long strings could cause DoS via regex matching or memory exhaustion.

**Attack Vector:**
```typescript
// Send huge query
window.api.search.query('a'.repeat(1000000), 100);
```

**Impact:**
- Application freeze/crash
- Memory exhaustion
- Poor user experience

**Recommendation:**
Add input validation:

```typescript
// renderer/hooks/useSearch.ts
const MAX_QUERY_LENGTH = 500;

const performSearch = async (query: string) => {
  if (!query.trim()) return;

  if (query.length > MAX_QUERY_LENGTH) {
    setError(`Query too long (max ${MAX_QUERY_LENGTH} characters)`);
    return;
  }

  // Sanitize query - remove control characters
  const sanitized = query.replace(/[\x00-\x1F\x7F]/g, '');

  setSearching(true);
  const results = await window.api.search.query(sanitized, 100);
  ...
};
```

**Priority:** MEDIUM - Add validation

---

#### 8. Weak Hash Functions

**Files Affected:**
- `src/main/services/ReindexService.ts:50` (MD5)
- `src/main/worker/batch/processor.ts:42` (SHA1)

**Vulnerability:**
MD5 and SHA1 are cryptographically broken. While used for non-security purposes (file change detection), collisions could cause indexing issues.

**Impact:**
- Hash collisions causing file change detection failures
- Two different files producing same hash (rare but possible)

**Recommendation:**
Upgrade to SHA-256:

```typescript
// ReindexService.ts
return crypto.createHash('sha256')
  .update(`${filePath}:${stats.size}:${stats.mtimeMs}`)
  .digest('hex');

// batch/processor.ts
const id = crypto.createHash('sha256')
  .update(JSON.stringify({ file: filePath, chunk: text, offset, page }))
  .digest('hex');
```

**Priority:** LOW - Upgrade when convenient (non-critical)

---

### 🟢 LOW SEVERITY

#### 9. Environment Variable Risks

**Files Affected:**
- `src/main/main.ts:38-40` (USER_DATA_PATH)
- `src/main/main.ts:261` (UPDATE_URL)
- `embedding_sidecar/embed_server.py:65-70` (EMBED_MODEL, EMBED_HOST, EMBED_PORT)

**Vulnerability:**
Environment variables control critical paths and URLs without validation.

**Impact:**
- Redirect database to arbitrary location
- Point to malicious update server
- Bind Python sidecar to public interface
- Download malicious ML models

**Recommendation:**
Add environment variable validation:

```typescript
// main.ts
if (process.env.USER_DATA_PATH) {
  const userPath = process.env.USER_DATA_PATH;

  // Validate path is absolute
  if (!path.isAbsolute(userPath)) {
    console.error('USER_DATA_PATH must be absolute path');
    process.exit(1);
  }

  // Ensure parent directory exists
  const parent = path.dirname(userPath);
  if (!fs.existsSync(parent)) {
    console.error(`Parent directory does not exist: ${parent}`);
    process.exit(1);
  }

  app.setPath('userData', userPath);
}

// For UPDATE_URL, validate it's HTTPS
if (process.env.UPDATE_URL) {
  try {
    const url = new URL(process.env.UPDATE_URL);
    if (url.protocol !== 'https:') {
      throw new Error('UPDATE_URL must use HTTPS');
    }
    autoUpdater.setFeedURL({ url: process.env.UPDATE_URL });
  } catch (err) {
    console.error('Invalid UPDATE_URL:', err);
    process.exit(1);
  }
}
```

For Python sidecar:

```python
# embed_server.py
BIND_HOST = os.getenv("EMBED_HOST", "127.0.0.1")
if BIND_HOST != "127.0.0.1":
    print(f"WARNING: Binding to {BIND_HOST} - ensure firewall is configured")

ALLOWED_MODEL_PREFIXES = [
    "sentence-transformers/",
    "BAAI/",
]

DEFAULT_MODEL = os.getenv("EMBED_MODEL", "sentence-transformers/paraphrase-multilingual-mpnet-base-v2")
if not any(DEFAULT_MODEL.startswith(prefix) for prefix in ALLOWED_MODEL_PREFIXES):
    print(f"ERROR: Model {DEFAULT_MODEL} not from trusted source")
    sys.exit(1)
```

**Priority:** LOW - Document and validate

---

#### 10. Information Disclosure via Error Messages

**Files Affected:**
- `embedding_sidecar/embed_server.py:250, 263, 267`
- Various log files in `~/Library/Logs/Semantica/`

**Vulnerability:**
Detailed error messages and logs expose file paths and system information.

**Impact:**
- Information disclosure about directory structure
- Exposure of usernames in paths
- Stack traces revealing internal implementation

**Recommendation:**
For production builds, use generic error messages:

```python
# embed_server.py
@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    # Log full error server-side
    logger.error(f"Error processing {request.url}: {exc}", exc_info=True)

    # Return generic error to client
    if isinstance(exc, HTTPException):
        return exc

    return HTTPException(
        status_code=500,
        detail="An internal error occurred"
    )
```

**Priority:** LOW - Acceptable for desktop application

---

## Coding Pattern Improvements

### 1. TypeScript Type Safety (HIGH PRIORITY)

**Issue:** Excessive use of `any` type (35+ instances)

**Critical Files:**
- `src/main/worker/index.ts` (10+ instances)
- `src/main/worker/database/operations.ts`
- `src/main/worker/batch/processor.ts`

**Recommendation:**

```typescript
// Define proper types for LanceDB
import type { Database, Table } from '@lancedb/lancedb';

// Create typed interfaces
interface DocumentChunk {
  id: string;
  path: string;
  text: string;
  vector: number[];
  page?: number;
  offset?: number;
}

interface FileStatus {
  path: string;
  status: 'pending' | 'indexed' | 'failed';
  hash?: string;
  error?: string;
  updatedAt: number;
}

// Replace any with proper types
let database: Database | null = null;
let documentsTable: Table<DocumentChunk> | null = null;
let fileStatusTable: Table<FileStatus> | null = null;

// Update function signatures
function sendToWorker(
  type: WorkerMessageType,
  payload: WorkerPayload = {}
): Promise<WorkerResponse> {
  // ...
}

// Define message type unions
type WorkerMessageType =
  | 'init'
  | 'watch'
  | 'enqueue'
  | 'search'
  | 'checkModel'
  | 'downloadModel';

type WorkerPayload =
  | { roots: string[]; excludePatterns?: string[] }
  | { paths: string[] }
  | { q: string; k: number }
  | Record<string, never>;  // For empty payload
```

**Files to Update:**
1. `src/main/worker/index.ts:151, 169, 176, 179, 180`
2. `src/main/worker/database/operations.ts:29, 89`
3. `src/main/worker/batch/processor.ts:29, 70`
4. `src/main/main.ts:194`

---

### 2. Missing Return Type Annotations (HIGH PRIORITY)

**Issue:** Functions missing explicit return types

**Recommendation:**

```typescript
// worker/index.ts
function emitStageProgress(
  stage: StartupStage,
  message?: string,
  progress?: number
): void {
  // ...
}

async function handleFileOriginal(filePath: string): Promise<void> {
  // ...
}

async function reindexAll(): Promise<void> {
  // ...
}

async function startWatching(
  roots: string[],
  excludePatterns?: string[],
  forceReindex: boolean = false
): Promise<void> {
  // ...
}
```

---

### 3. Code Duplication - Logger Wrapper (MEDIUM PRIORITY)

**Issue:** Logger wrapper pattern repeated in 3+ files

**Recommendation:**

```typescript
// src/shared/utils/logger.ts
export const createCategoryLogger = (category: LogCategory) => {
  return {
    log: (message: string, ...args: any[]) =>
      logger.log(category, message, ...args),
    error: (message: string, ...args: any[]) =>
      logger.error(category, message, ...args),
    warn: (message: string, ...args: any[]) =>
      logger.warn(category, message, ...args),
  };
};

// Usage in files
// worker/WorkerStartup.ts
import { createCategoryLogger } from '../../shared/utils/logger';
const log = createCategoryLogger('WORKER-STARTUP');

// worker/PythonSidecarService.ts
const log = createCategoryLogger('SIDECAR-SERVICE');
```

---

### 4. Error Handling Utility (MEDIUM PRIORITY)

**Issue:** Repeated error type checking pattern

**Recommendation:**

```typescript
// src/shared/utils/errors.ts
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

// Usage
import { getErrorMessage, getErrorStack } from '../../shared/utils/errors';

try {
  await operation();
} catch (error) {
  logger.error('Operation failed:', getErrorMessage(error));
  if (getErrorStack(error)) {
    logger.error('Stack:', getErrorStack(error));
  }
}
```

---

### 5. Magic Numbers to Constants (MEDIUM PRIORITY)

**Issue:** Hardcoded numbers scattered throughout codebase

**Recommendation:**

```typescript
// src/main/constants/indexing.ts
export const CHUNK_CONFIG = {
  DEFAULT_CHUNK_SIZE: 500,
  DEFAULT_CHUNK_OVERLAP: 60,
  PDF_CHUNK_SIZE: 50000,
} as const;

export const QUEUE_CONFIG = {
  MAX_QUEUE_SIZE: 2000,
  BATCH_SIZE: 32,
  MAX_TOKENS_PER_BATCH: 7000,
  BACKPRESSURE_THRESHOLD: 1000,
  MAX_CONCURRENT_BATCHES: 2,
  MAX_RETRIES: 3,
} as const;

export const TIMING_CONFIG = {
  WORKER_RESTART_DELAY_MS: 1000,
  MODEL_CHECK_INTERVAL_MS: 100,
  MODEL_CHECK_TIMEOUT_MS: 30000,
  EMBEDDER_HEALTH_CHECK_INTERVAL_MS: 60000,
} as const;

// Usage
import { CHUNK_CONFIG, QUEUE_CONFIG } from '../../constants/indexing';

const chunkSize = parserDef.chunkSize || CHUNK_CONFIG.DEFAULT_CHUNK_SIZE;
const chunkOverlap = parserDef.chunkOverlap || CHUNK_CONFIG.DEFAULT_CHUNK_OVERLAP;
```

**Files to Update:**
1. `src/main/worker/index.ts:348, 380-381, 954, 969`
2. `src/main/parsers/pdf.ts:107`
3. `src/main/core/embedding/EmbeddingQueue.ts:62, 64, 71-74`
4. `src/main/main.ts:148, 208`

---

### 6. Refactor Large Functions (MEDIUM PRIORITY)

**Issue:** `handleFileOriginal()` is ~200 lines with deep nesting

**Recommendation:**

```typescript
// Break into focused functions
async function validateFileExists(filePath: string): Promise<void> {
  const exists = await fs.promises.access(filePath, fs.constants.R_OK)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    throw new Error(`File not found: ${filePath}`);
  }
}

async function shouldReindexFile(
  filePath: string,
  currentHash: string,
  parserVersion: number
): Promise<boolean> {
  const status = await getFileStatus(filePath);

  if (!status || status.status !== 'indexed') {
    return true;
  }

  if (status.hash !== currentHash) {
    return true;
  }

  if (status.parserVersion !== parserVersion) {
    return true;
  }

  return false;
}

async function parseAndChunkFile(
  filePath: string
): Promise<Array<{ text: string; page?: number; offset?: number }>> {
  const parser = selectParser(filePath);
  const rawContent = await parser(filePath);

  const chunks = chunkText(
    rawContent.text,
    CHUNK_CONFIG.DEFAULT_CHUNK_SIZE,
    CHUNK_CONFIG.DEFAULT_CHUNK_OVERLAP
  );

  return chunks.map((text, i) => ({
    text,
    page: rawContent.page,
    offset: i
  }));
}

async function queueChunksForEmbedding(
  chunks: Array<{ text: string; page?: number; offset?: number }>,
  filePath: string
): Promise<void> {
  for (const chunk of chunks) {
    await embeddingQueue.enqueue({
      filePath,
      text: chunk.text,
      page: chunk.page,
      offset: chunk.offset
    });
  }
}

// Main function becomes simple orchestration
async function handleFileOriginal(filePath: string): Promise<void> {
  try {
    await validateFileExists(filePath);

    const currentHash = await calculateFileHash(filePath);
    const shouldReindex = await shouldReindexFile(
      filePath,
      currentHash,
      CURRENT_PARSER_VERSION
    );

    if (!shouldReindex) {
      logger.log('INDEXING', `File up to date: ${filePath}`);
      return;
    }

    const chunks = await parseAndChunkFile(filePath);
    await queueChunksForEmbedding(chunks, filePath);

    await updateFileStatus(filePath, {
      status: 'indexed',
      hash: currentHash,
      parserVersion: CURRENT_PARSER_VERSION
    });
  } catch (error) {
    await handleIndexingError(filePath, error);
  }
}
```

---

### 7. Silent Error Suppression (LOW PRIORITY)

**Issue:** Errors caught without logging

**Recommendation:**

```typescript
// main.ts:72 - Add logging
worker?.terminate().catch((err) => {
  logger.error('MAIN', 'Worker termination failed:', err);
});

// database/operations.ts:112 - Log index creation failures
await tbl.createIndex('vector').catch((err) => {
  // Index might already exist, which is fine
  logger.log('DATABASE', 'Vector index already exists or creation failed:', err);
});
```

---

### 8. Event Listener Cleanup (LOW PRIORITY)

**Issue:** React components not cleaning up IPC listeners

**Recommendation:**

```typescript
// renderer/App.tsx
useEffect(() => {
  const handleFilesLoaded = () => {
    setIsLoading(false);
  };

  window.api.on('files:loaded', handleFilesLoaded);

  // Cleanup on unmount
  return () => {
    window.api.off('files:loaded', handleFilesLoaded);
  };
}, []);
```

---

## Security Strengths

### ✅ Electron Security Configuration
- Context isolation enabled
- Node integration disabled
- Sandbox enabled
- Preload script properly configured
- No eval() or Function() usage
- Single instance lock (with test override)

### ✅ Process Isolation
- Worker thread for heavy processing
- Python sidecar for ML operations
- Localhost-only communication (127.0.0.1:8421)
- No network exposure by design

### ✅ Data Protection
- No sensitive credentials in configuration
- Local-only data storage
- No cloud synchronization

---

## Remediation Priorities

### Immediate (Critical - Fix Now)
1. ✅ Fix XSS in SearchResult.tsx and DetailPanel.tsx
2. ✅ Add path validation in Python sidecar
3. ✅ Add settings validation in config.ts
4. ✅ Replace executeJavaScript with IPC send

### Short-term (High - Next Sprint)
5. Add validation to shell APIs (openPath, openExternal)
6. Implement dialog template system
7. Add query length validation
8. Replace any types with proper TypeScript types

### Medium-term (Quality Improvements)
9. Add return type annotations
10. Extract constants from magic numbers
11. Refactor large functions
12. Consolidate error handling utilities

### Long-term (Polish)
13. Upgrade hash functions to SHA-256
14. Add environment variable validation
15. Improve error message sanitization

---

## Testing Recommendations

### Security Testing
1. **XSS Testing:**
   - Create test documents with HTML/JavaScript payloads
   - Verify safe rendering in search results
   - Test with various XSS vectors (event handlers, script tags, data URIs)

2. **Path Traversal Testing:**
   - Create symlinks to sensitive files
   - Test with relative paths (../)
   - Verify path normalization works correctly

3. **Input Validation Testing:**
   - Test settings updates with invalid values
   - Test query strings with extreme lengths
   - Test dialog inputs with special characters

### Integration Testing
1. Test Python sidecar with validated paths
2. Test IPC communication with malformed payloads
3. Test shell API calls with various path formats

### Automated Testing
Add security-focused test suite:

```typescript
// tests/security/xss.test.ts
describe('XSS Protection', () => {
  it('should not execute script tags in search results', () => {
    const maliciousText = '<script>alert("xss")</script>';
    const result = { text: maliciousText, score: 0.9 };

    render(<SearchResult result={result} query="test" />);

    // Verify no script executed
    expect(document.scripts.length).toBe(0);
  });

  it('should escape HTML in highlighted text', () => {
    const htmlText = '<img src=x onerror="alert(1)">';
    const result = { text: htmlText, score: 0.9 };

    const { container } = render(<SearchResult result={result} query="test" />);

    // Verify HTML is escaped
    expect(container.querySelector('img')).toBeNull();
  });
});

// tests/security/path-traversal.test.ts
describe('Path Validation', () => {
  it('should reject symlinks outside allowed directories', async () => {
    const response = await fetch('http://127.0.0.1:8421/embed-file', {
      method: 'POST',
      body: JSON.stringify({ path: '/tmp/symlink-to-etc-passwd' })
    });

    expect(response.status).toBe(403);
  });

  it('should normalize relative paths', async () => {
    const response = await fetch('http://127.0.0.1:8421/embed-file', {
      method: 'POST',
      body: JSON.stringify({ path: '../../../etc/passwd' })
    });

    expect(response.status).toBe(403);
  });
});
```

---

## Compliance & Standards

### OWASP Top 10 (2021) Assessment

| Risk | Status | Notes |
|------|--------|-------|
| A01: Broken Access Control | 🟡 Partial | Path traversal in sidecar, shell API exposure |
| A02: Cryptographic Failures | 🟢 Low Risk | Weak hashes (MD5/SHA1) for non-crypto use |
| A03: Injection | 🔴 HIGH | XSS via dangerouslySetInnerHTML |
| A04: Insecure Design | 🟢 Good | Well-architected with process isolation |
| A05: Security Misconfiguration | 🟡 Partial | Environment variables not validated |
| A06: Vulnerable Components | 🟢 Good | Dependencies up to date |
| A07: Authentication Failures | N/A | Local-only, single-user application |
| A08: Software & Data Integrity | 🟢 Good | Code signing, update verification |
| A09: Logging Failures | 🟢 Good | Comprehensive logging system |
| A10: Server-Side Request Forgery | N/A | No server-side requests |

---

## Conclusion

The Semantica codebase demonstrates solid security fundamentals for an Electron application but requires immediate attention to **XSS vulnerabilities** and **path validation**. The coding patterns are generally good but would benefit from stronger TypeScript typing and better separation of concerns.

**Overall Security Grade:** B- (after fixes: A-)
**Code Quality Grade:** B+

### Next Steps
1. Implement critical security fixes (XSS, path validation, settings validation)
2. Add security-focused test suite
3. Improve TypeScript type safety
4. Refactor large functions for maintainability
5. Document security assumptions and threat model

---

**Review Completed:** November 2025
**Recommended Re-review:** After implementing critical fixes
