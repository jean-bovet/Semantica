# Planning Documents

This folder contains detailed plans for future enhancements to Semantica.

**Last Updated:** 2025-10-28

## Architecture Context

**Current Stack (v1.0.3+):**
- **Embedding Service:** Python sidecar with sentence-transformers (FastAPI HTTP server on port 8421)
- **Previous Versions:** Removed Ollama (v2) and Transformers.js/ONNX (v1) support
- **Communication:** Worker ↔ Python Sidecar via HTTP REST API (not child process messages)

Planning documents reference these technologies. See individual docs for Python sidecar compatibility notes.

## Active Planning Documents

### Technical Debt & Refactoring
- 🔧 [Worker Refactoring Plan](./worker-refactoring-plan.md) - Break down 1735-line worker/index.ts (needs update for Python sidecar)
- 📝 [Specs vs Code Alignment](./specs-vs-code-alignment.md) - Documentation drift audit (Sept 2025)
- ⚙️ [Config Audit](./config-audit.md) - Frontend build & TypeScript config review

### Architecture & Testing
- 🧪 [Startup Testing Strategy](./startup-testing-strategy.md) - StartupCoordinator pattern with sensors/actions (needs update for Python sidecar)
- 📨 [Message Bus Refactoring](./message-bus-refactoring.md) - Typed message passing for Main ↔ Worker (partially obsolete with Python HTTP architecture)

### Future Enhancements
- 🚀 [Adaptive Performance Management](./adaptive-performance-management.md) - Intelligent concurrency based on hardware, battery, thermals

## Completed/Archived Documents

See [archive/](./archive/) for:
- ✅ **Database Version Marker** - Implemented & tested (Oct 2025)
- ✅ **Token Estimation Fix** - Implemented (Oct 2025)
- ✅ **Producer-Consumer Architecture** - Implemented as EmbeddingQueue (Oct 2025)
- ✅ **Auto-Update Implementation** - Completed (Aug 2025)
- ✅ **Performance Optimization** - Completed (Sept 2025)
- 📦 **Ollama-related Plans** - Obsolete (Ollama removed in favor of Python sidecar)
- 📦 **Testing Plans** - Various completed testing initiatives
- 📦 **Integration Testing Strategy** - Obsolete (referenced removed Transformers.js)

## Planning Document Template

When creating new planning documents, use this structure:

```markdown
# Feature Name

**Status**: 📋 Planned / 🚧 In Progress / ✅ Implemented  
**Priority**: High / Medium / Low  
**Complexity**: Low / Medium / High  
**Estimated Effort**: X days  

## Problem Statement
What problem does this solve?

## Solution Overview
High-level approach

## Detailed Implementation Plan
Step-by-step technical details

## Benefits
Why this is valuable

## Open Questions
Unresolved design decisions

## Success Metrics
How we measure success
```

## Decision Log

Major technical decisions and their rationale:

### 2025
1. **Python Sidecar Architecture** (Oct 2025): Replaced Ollama with Python FastAPI server using sentence-transformers for 100% reliability vs 98-99% with Ollama
2. **Database Version Marker** (Oct 2025): Track schema versions with `.db-version` file for automatic migrations
3. **Producer-Consumer Queue** (Oct 2025): Implemented EmbeddingQueue to prevent deadlocks when processing multiple large files
4. **Remove Transformers.js/ONNX** (Oct 2025): Cleaned up legacy embedding implementation after Python sidecar proved stable
5. **Electron 38 Upgrade** (Oct 2025): Updated to Chromium 140, Node.js 22.19.0 (requires macOS 12+)

### 2024
6. **Search-First UI** (Aug 2024): Modal settings to maximize search space and focus user attention
7. **File Status in Database** (Aug 2024): Persistent status tracking enables better debugging and user feedback

## Contributing

When adding new plans:
1. Create a detailed markdown file in this folder
2. Update this README with a link and brief description
3. Use the template above for consistency
4. Include concrete implementation steps
5. Consider migration/upgrade paths
6. Think about error handling and edge cases