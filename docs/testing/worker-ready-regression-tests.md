# Worker Ready Signaling - Regression Tests

## Background

**Bug Fixed:** 2025-10-27
**Root Cause:** The `workerReady` flag in `main.ts` was not set to `true` when receiving a `StartupStageMessage` with `stage='ready'`, causing all IPC calls to fail with "Worker not ready" error.

**Impact:** Settings UI could not load folders from config.json, making the app appear to have no indexed folders even when folders were configured.

## Fix

Added one line in `src/main/main.ts:86`:
```typescript
if (msg.stage === 'ready') {
  workerReady = true; // ← Added this line
  // ... rest of handler
}
```

## Tests Created to Prevent Regression

### 1. Unit Test: tests/unit/worker-ready-signaling.spec.ts

**Coverage:** 10 test cases

**What it tests:**
- ✅ StartupStageMessage protocol validation
- ✅ `workerReady` flag starts as `false`
- ✅ IPC calls fail when `workerReady=false`
- ✅ `workerReady` is set to `true` when receiving `stage='ready'`
- ✅ IPC calls succeed after `workerReady=true`
- ✅ Legacy `type: 'ready'` format still works (backward compatibility)
- ✅ Other stages do NOT set `workerReady`
- ✅ Complete startup sequence works correctly

**How to run:**
```bash
NODE_ENV=test npx vitest --run tests/unit/worker-ready-signaling.spec.ts
```

**Expected result:** All 10 tests pass in ~25ms

### 2. E2E Test: tests/e2e/settings-folders-display.spec.ts

**Coverage:** 3 test scenarios

**What it tests:**
- ✅ Folders from config.json are displayed in Settings UI
- ✅ Empty config shows "No folders" message
- ✅ No "Worker not ready" errors when opening settings after startup

**How to run:**
```bash
npm run test:e2e -- tests/e2e/settings-folders-display.spec.ts
```

**Note:** E2E test uses Playwright and launches a real Electron app with test config.

## How These Tests Prevent Regression

### Unit Test Protection
If someone:
- Removes the `workerReady = true` line
- Changes the message format without updating handlers
- Modifies the startup protocol

Then: **Unit tests will fail immediately**, showing exactly what broke.

### E2E Test Protection
If someone:
- Changes IPC handler registration order
- Modifies Settings UI loading logic
- Breaks the config → UI data flow

Then: **E2E tests will fail**, showing the user-facing symptom.

## Related Files

**Source files:**
- `src/main/main.ts` - Main process, worker message handler
- `src/main/worker/WorkerStartup.ts` - Worker startup sequence
- `src/shared/types/startup.ts` - Startup protocol types

**Test files:**
- `tests/unit/worker-ready-signaling.spec.ts` - Unit tests
- `tests/e2e/settings-folders-display.spec.ts` - E2E tests

## Testing Strategy

This bug fix follows a **multi-layer testing approach**:

1. **Unit tests** - Fast, isolated, test the exact fix
2. **E2E tests** - Slow, integrated, test the user experience
3. **Type safety** - TypeScript ensures message format consistency

Together, these layers ensure:
- The technical fix works correctly (unit)
- The user experience works as expected (e2e)
- The protocol stays consistent (types)

## Lessons Learned

**Why the bug happened:**
1. Migrated to new `StartupStageMessage` protocol
2. Added handler for new protocol format
3. Forgot to set `workerReady = true` in new handler
4. Old `type: 'ready'` handler was never called
5. No tests caught this during development

**Prevention:**
- ✅ Now have explicit tests for worker ready signaling
- ✅ Tests cover both old and new protocol formats
- ✅ E2E tests validate the user-facing behavior
- ✅ Documentation explains the bug and fix clearly

## Future Improvements

**Potential additions:**
1. Contract test for Worker ↔ Main message protocol
2. Integration test for all IPC handlers
3. Automated test that verifies all stages in `STARTUP_STAGE_ORDER` are handled
4. Performance test to ensure startup completes within timeout

**Not needed now, but good to have for:**
- Large refactorings of the startup sequence
- Adding new startup stages
- Changing the IPC communication pattern
