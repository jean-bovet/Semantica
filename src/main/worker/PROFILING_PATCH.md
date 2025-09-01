# Minimal Profiling Integration

To add profiling to the existing worker with minimal changes, add these 5 lines to `src/main/worker/index.ts`:

## Step 1: Add import at the top of the file (after other imports)

```typescript
// Add this import near line 20 (after other imports)
import { setupProfiling, profileHandleFile, timeOperation, recordEvent } from './profiling-integration';
```

## Step 2: Initialize profiling in initDatabase function (around line 299)

```typescript
async function initDatabase(userDataPath: string) {
  // ... existing code ...
  
  // Add this line at the end of initDatabase function (around line 299)
  setupProfiling();
  
  console.log('Worker ready');
}
```

## Step 3: Wrap handleFile function (around line 474)

Replace the function declaration:
```typescript
// OLD:
async function handleFile(filePath: string) {

// NEW: 
const handleFileOriginal = async function(filePath: string) {
```

Then add this right after the function:
```typescript
// Add this after the handleFile function definition (around line 670)
const handleFile = profileHandleFile(handleFileOriginal);
```

## Step 4: Track embedder restarts (in checkEmbedderMemory call, around line 65)

```typescript
// Around line 65, modify the embedder restart check:
const restarted = await checkEmbedderMemory();
if (restarted) {
  recordEvent('embedderRestart'); // Add this line
  console.log('[MEMORY] ♾️ Embedder process restarted due to memory limits');
}
```

## Step 5: Track memory throttling (in ConcurrentQueue callback, around line 120)

```typescript
// Around line 120, in the onMemoryThrottle callback:
onMemoryThrottle: (newLimit, memoryMB) => {
  recordEvent(newLimit < concurrencySettings.optimal ? 'throttleStart' : 'throttleEnd'); // Add this
  console.log(`[MEMORY] ⚠️ Adjusting concurrency: ${newLimit} (RSS: ${Math.round(memoryMB)}MB)`);
}
```

## That's it! 

With these 5 minimal changes, you get:
- Full performance profiling when `PROFILE=true` is set
- No impact on normal operation when profiling is disabled
- Automatic report generation on shutdown
- Detailed metrics for every file processed

## Usage

```bash
# Run with profiling enabled
PROFILE=true npm run dev

# Or add to package.json scripts:
"dev:profile": "PROFILE=true npm run dev"

# Then:
npm run dev:profile

# Stop the app (Ctrl+C) to generate report
# Report will be saved to ~/fss-performance-*.json
```

## Alternative: Zero Code Changes

If you don't want to modify any existing code, you can create a wrapper script:

```bash
# Create scripts/dev-with-profiling.sh
#!/bin/bash
export PROFILE=true
echo "🔬 Starting with performance profiling enabled..."
echo "📊 Report will be generated on shutdown (Ctrl+C)"
npm run dev
```

Then use `./scripts/dev-with-profiling.sh` instead of `npm run dev`.