# Planning Documents

This folder contains detailed plans for future enhancements to the Offline Mac Search application.

## Planned Enhancements

### High Priority
- 📋 [Parser Version Tracking](./parser-version-tracking.md) - Automatic re-indexing when parsers improve
- 🔍 [OCR Integration](./ocr-integration.md) - *To be planned* - Support for scanned documents
- 🔄 [Incremental Sync](./incremental-sync.md) - *To be planned* - Efficient folder watching

### Medium Priority  
- 📊 [Analytics Dashboard](./analytics-dashboard.md) - *To be planned* - Indexing statistics and insights
- 🎯 [Smart Prioritization](./smart-prioritization.md) - *To be planned* - Intelligent queue management
- 🔐 [Encrypted Files](./encrypted-files.md) - *To be planned* - Support for password-protected documents

### Low Priority
- 🌍 [Multi-language Support](./multi-language.md) - *To be planned* - Better non-English text handling
- 📱 [Mobile Companion](./mobile-companion.md) - *To be planned* - iOS app for remote search
- ☁️ [Cloud Backup](./cloud-backup.md) - *To be planned* - Index backup and sync

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

1. **Parser Version Tracking** (2024-08-24): Chosen over simple retry mechanism for better control and transparency
2. **File Status in Database** (2024-08-24): Persistent status tracking enables better debugging and user feedback
3. **Search-First UI** (2024-08-24): Modal settings to maximize search space and focus user attention

## Contributing

When adding new plans:
1. Create a detailed markdown file in this folder
2. Update this README with a link and brief description
3. Use the template above for consistency
4. Include concrete implementation steps
5. Consider migration/upgrade paths
6. Think about error handling and edge cases