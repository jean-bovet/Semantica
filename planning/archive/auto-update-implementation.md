# Auto-Update Complete Implementation Plan for Semantica

> **Note**: For immediate implementation, see [`auto-update-minimal.md`](./auto-update-minimal.md) which uses the 2-line electron-updater approach. This document covers the full-featured implementation for Phase 2.

## Overview

This document outlines the **complete implementation plan** for advanced auto-update functionality in Semantica, including custom UI, user preferences, and detailed progress tracking.

**Last Updated**: August 2025 - Aligned with official Electron documentation and best practices.

## Implementation Strategy

### Phase 1: Minimal Implementation (1-2 days) ✅
**See**: [`auto-update-minimal.md`](./auto-update-minimal.md)
- 2-line implementation with electron-updater
- Native OS notifications
- Automatic background downloads
- Zero configuration for users

### Phase 2: Advanced Features (When Needed)
**This document** - Implement based on user feedback:
- Custom update UI
- Download progress tracking  
- User preferences
- Release notes display
- Manual update controls

## Goals

- **Seamless Updates**: Users receive updates automatically without visiting GitHub
- **User Control**: Users can choose when to download and install updates
- **Reliability**: Robust error handling and fallback mechanisms
- **Security**: Code-signed releases with verified updates
- **Transparency**: Clear communication about update status and progress

## Technical Architecture

### Update Flow
```
1. App Launch → Check for Updates (after 3s delay)
2. Update Available → Show Notification → User Choice
3. User Accepts → Download Update → Show Progress
4. Download Complete → Prompt to Restart
5. App Restart → Install Update → Launch New Version
```

### Components
- **Main Process**: Update checker and installer
- **Renderer Process**: UI notifications and progress
- **GitHub Releases**: Update distribution channel
- **electron-updater**: Core update library (recommended over built-in autoUpdater)

### Why electron-updater?
Per official Electron documentation, electron-updater provides:
- Linux support (built-in autoUpdater only supports macOS/Windows)
- Code signature validation on all platforms
- Automatic metadata file generation
- Download progress events
- Staged rollouts support
- Multiple provider support (GitHub, S3, generic HTTP)

## Phase 2: Advanced Implementation

> **Prerequisites**: Phase 1 minimal auto-update must be working first.

### Component 1: Enhanced Infrastructure

#### 1.1 Dependencies Installation
```bash
npm install --save electron-updater
npm install --save-dev electron-log
```

**Note**: electron-log is strongly recommended by the Electron team for debugging update issues.

#### 1.2 Project Configuration
**File**: `package.json`
```json
{
  "version": "1.0.0",
  "build": {
    "appId": "com.semantica.app",
    "productName": "Semantica",
    "directories": {
      "output": "dist-app"
    },
    "publish": [
      {
        "provider": "github",
        "owner": "bovet",
        "repo": "FSS",
        "releaseType": "release"
      }
    ],
    "mac": {
      "category": "public.app-category.productivity",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist",
      "notarize": {
        "teamId": "YOUR_TEAM_ID"
      }
    },
    "dmg": {
      "sign": false
    },
    "win": {
      "target": "nsis",
      "publisherName": "Semantica"
    },
    "linux": {
      "target": "AppImage",
      "category": "Utility"
    }
  }
}
```

#### 1.3 Create Update Module
**File**: `app/electron/updater.ts`

**Minimal Implementation** (per official docs - only 2 lines needed):
```typescript
import { autoUpdater } from "electron-updater";
import log from 'electron-log';

// Configure logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// Basic auto-update
autoUpdater.checkForUpdatesAndNotify();
```

**Full Implementation**:
- Core auto-updater implementation
- Event handlers for update lifecycle
- User notification system
- Progress tracking
- **Important**: Do NOT call setFeedURL - electron-builder handles this automatically

#### 1.4 Entitlements Configuration
**File**: `build/entitlements.mac.plist`
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
```

**Note**: The `hardenedRuntime: true` setting is required for notarization and auto-updates on macOS.

### Phase 2: Main Process Integration (Week 1-2)

#### 2.1 Update Checker Integration
**File**: `app/electron/main.ts`
- Initialize updater on app ready (with 3-10 second delay recommended)
- Add menu item for manual update check
- Schedule periodic update checks (every 30 minutes per best practices)
- Handle app lifecycle events
- **Windows**: Check for --squirrel-firstrun flag to avoid early update checks
- Handle 'update-downloaded' event carefully to avoid data loss

#### 2.2 IPC Communication
**File**: `app/electron/preload.ts`
- Expose update events to renderer
- Add methods for update control
- Handle progress updates

#### 2.3 Logging System
- Integrate electron-log
- Log update events
- Error tracking and debugging
- User-accessible log files

### Phase 3: UI Components (Week 2)

#### 3.1 Update Notification Component
**File**: `app/src/components/UpdateNotification.tsx`
```typescript
interface UpdateNotificationProps {
  version: string;
  releaseNotes?: string;
  onAccept: () => void;
  onDecline: () => void;
}
```

#### 3.2 Download Progress Component
**File**: `app/src/components/UpdateProgress.tsx`
- Progress bar visualization
- Download speed indicator
- Estimated time remaining
- Cancel option

#### 3.3 Settings Integration
**File**: `app/src/components/SettingsView.tsx`
- Auto-update toggle
- Check frequency setting
- Manual check button
- Current version display

### Phase 4: Code Signing & Notarization (Week 2-3)

#### 4.1 Apple Developer Setup
- [ ] Obtain Apple Developer Certificate ($99/year) - REQUIRED for auto-updates
- [ ] Create Developer ID Application certificate (for distribution outside Mac App Store)
- [ ] Create Developer ID Installer certificate (optional for .pkg installers)
- [ ] Configure notarization credentials (REQUIRED - apps won't run on macOS without it)

**Critical**: Per official docs, your application MUST be signed for automatic updates on macOS. Unsigned apps will be blocked by Gatekeeper.

#### 4.2 Environment Variables
**File**: `.env.local`
```bash
# Required for notarization
APPLE_ID=your-apple-id@email.com
APPLE_APP_SPECIFIC_PASSWORD=app-specific-password  # Generate at appleid.apple.com
APPLE_TEAM_ID=YOUR_TEAM_ID

# Required for code signing on CI/CD
CSC_LINK=path/to/certificate.p12  # Base64 encoded on CI
CSC_KEY_PASSWORD=certificate-password

# Optional but recommended
CSC_NAME="Developer ID Application: Your Name (TEAMID)"
```

**Security Note**: Never store these in plaintext in your repo. Use environment variables or CI secrets.

#### 4.3 Build Script Updates
**File**: `package.json`
```json
{
  "scripts": {
    "dist": "npm run build && electron-builder",
    "dist:mac": "npm run dist -- --mac",
    "dist:win": "npm run dist -- --win",
    "dist:linux": "npm run dist -- --linux",
    "release": "npm run dist -- --publish always"
  }
}
```

### Phase 5: Testing & Validation (Week 3)

#### 5.1 Test Scenarios
- [ ] Fresh install → Update available
- [ ] Update download → Success
- [ ] Update download → Network failure
- [ ] Update download → Corrupted file
- [ ] Update installation → Success
- [ ] Update installation → Rollback
- [ ] Multiple updates → Sequential installation
- [ ] Background download → App quit
- [ ] Differential updates → Bandwidth optimization

#### 5.2 Version Testing Matrix
| From Version | To Version | Update Type | Expected Result |
|--------------|------------|-------------|-----------------|
| 1.0.0 | 1.0.1 | Patch | Auto-update works |
| 1.0.0 | 1.1.0 | Minor | Auto-update works |
| 1.0.0 | 2.0.0 | Major | Auto-update with warning |
| 1.0.0 | 0.9.0 | Downgrade | Blocked |

#### 5.3 Platform Testing
- [ ] macOS Intel (signed & notarized)
- [ ] macOS Apple Silicon (signed & notarized)
- [ ] Windows 10 (optionally signed)
- [ ] Windows 11 (optionally signed)
- [ ] Linux - Note: Auto-update not supported by built-in autoUpdater, use distribution package manager

#### 5.4 Development Testing
For testing without packaging, create `dev-app-update.yml` in project root:
```yaml
owner: bovet
repo: FSS
provider: github
```

### Phase 6: Release Process (Week 3-4)

#### 6.1 Release Workflow
```yaml
name: Release
on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build
      - run: npm run dist
      - uses: softprops/action-gh-release@v1
        with:
          files: dist-app/*
```

#### 6.2 Release Checklist
- [ ] Update version in package.json
- [ ] Update CHANGELOG.md
- [ ] Create git tag
- [ ] Push tag to trigger workflow
- [ ] Verify GitHub release created
- [ ] Test auto-update from previous version
- [ ] Update documentation

## Configuration Options

### User Preferences
```typescript
interface UpdatePreferences {
  autoDownload: boolean;        // Default: false
  autoInstallOnQuit: boolean;   // Default: true
  checkFrequency: number;        // Hours, Default: 4
  allowPrerelease: boolean;      // Default: false
  allowDowngrade: boolean;       // Default: false
}
```

### Update Channels
- **Stable**: Production releases
- **Beta**: Pre-release testing (use allowPrerelease option)
- **Alpha**: Early testing (use allowPrerelease option)

**Note**: electron-updater supports staged rollouts via percentage-based distribution.

## Security Considerations

### Code Signing
- **macOS**: Required for auto-update
- **Windows**: Recommended to avoid warnings
- **Linux**: Optional but recommended

### Update Verification
- Verify update signature before installation
- Check file integrity with checksums
- Validate version progression
- Prevent downgrade attacks

### Network Security
- HTTPS only for update checks (enforced by electron-updater)
- Certificate validation automatic with electron-updater
- Proxy support built-in
- Retry with exponential backoff
- Code signature validation on all platforms (electron-updater feature)

## Error Handling

### Error Types
1. **Network Errors**: Retry with backoff
2. **Signature Errors**: Block installation, notify user
3. **Disk Space Errors**: Check before download
4. **Permission Errors**: Request elevation (Windows)
5. **Corrupted Downloads**: Re-download with resume

### Fallback Mechanisms
- Manual download link in error dialog
- Rollback to previous version on failure
- Offline update from local file
- Skip problematic updates

## Monitoring & Analytics

### Metrics to Track
- Update adoption rate
- Download success rate
- Installation success rate
- Error frequency by type
- Time to update (from release to installation)
- Bandwidth usage

### Logging
- Local logs for debugging
- Anonymous telemetry (opt-in)
- Error reporting to Sentry (optional)

## Documentation Updates

### User Documentation
- [ ] Update README with auto-update information
- [ ] Add troubleshooting guide
- [ ] Document manual update process
- [ ] Explain update preferences

### Developer Documentation
- [ ] Release process guide
- [ ] Testing procedures
- [ ] Troubleshooting common issues
- [ ] Version numbering scheme

## Timeline

| Phase | Duration | Status |
|-------|----------|---------|
| **Phase 1: Minimal** | 1-2 days | See `auto-update-minimal.md` |
| **Phase 2: Advanced** | 2-3 weeks | Only if needed |
| - Custom UI | 3 days | Based on feedback |
| - Preferences | 2 days | Based on feedback |
| - Progress tracking | 2 days | Based on feedback |
| - Release notes | 1 day | Based on feedback |
| - Testing | 3 days | Required |

## Success Criteria

- [ ] 90% of users on latest version within 1 week
- [ ] <1% update failure rate
- [ ] Zero critical update bugs in production
- [ ] Update process completes in <2 minutes
- [ ] User satisfaction score >4/5

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Apple notarization delays | High | Medium | Start process early, have backup |
| Update server downtime | High | Low | Use GitHub's CDN, multiple mirrors |
| Corrupted updates | High | Low | Checksums, signature verification |
| User refuses updates | Medium | High | Clear value communication |
| Breaking changes | High | Low | Careful testing, staged rollout |

## Platform-Specific Considerations

### macOS
- **Requirement**: Apps MUST be signed and notarized for auto-updates
- **Timing**: Notarization takes 5-10 minutes
- **Certificates**: Need Developer ID Application certificate

### Windows
- **Squirrel.Windows**: Handle --squirrel-firstrun flag
- **Code Signing**: Recommended to avoid SmartScreen warnings
- **NSIS**: Preferred installer format

### Linux
- **Limited Support**: Consider using AppImage with electron-updater
- **Alternative**: Use distribution package managers

## Alternative Approaches Considered

### 1. Manual Updates Only
- **Pros**: Simple, no infrastructure needed
- **Cons**: Poor user experience, low adoption
- **Decision**: Rejected - doesn't meet user expectations

### 2. In-App Store Updates
- **Pros**: Familiar process, handled by OS
- **Cons**: App Store fees, review delays
- **Decision**: Rejected - want direct control

### 3. Custom Update Server
- **Pros**: Full control, private updates
- **Cons**: Infrastructure cost, maintenance
- **Decision**: Rejected - GitHub releases sufficient

## Conclusion

Implementing auto-update will significantly improve the user experience and ensure users benefit from the latest features and security updates. The phased approach minimizes risk while delivering value incrementally.

## Appendix

### A. Resources
- [Official Electron Auto-Update Tutorial](https://www.electronjs.org/docs/latest/tutorial/updates)
- [electron-updater documentation](https://www.electron.build/auto-update)
- [Official Code Signing Guide](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [electron-builder Code Signing](https://www.electron.build/code-signing)
- [macOS Notarization Guide](https://www.electron.build/notarize)
- [GitHub Releases API](https://docs.github.com/en/rest/releases)
- [update.electronjs.org](https://github.com/electron/update.electronjs.org) - Free update server for OSS projects

### B. Example Update Flow Diagram
```
User Launch App
     ↓
Check for Updates ←─────┐
     ↓                  │
Update Available?       │
     ├─ No ─────────────┤
     ├─ Yes             │
     ↓                  │
Show Notification       │
     ↓                  │
User Accepts?           │
     ├─ No ─────────────┤
     ├─ Yes             │
     ↓                  │
Download Update         │
     ↓                  │
Show Progress           │
     ↓                  │
Download Complete       │
     ↓                  │
Prompt Restart          │
     ↓                  │
User Restarts?          │
     ├─ No ─────────────┤
     ├─ Yes             │
     ↓                  │
Install & Restart       │
     ↓                  │
Launch New Version ─────┘
```

### C. Sample Release Notes Template
```markdown
## Version X.Y.Z

### ✨ New Features
- Feature 1 description
- Feature 2 description

### 🐛 Bug Fixes
- Fix 1 description
- Fix 2 description

### 🔧 Improvements
- Improvement 1 description
- Improvement 2 description

### ⚠️ Breaking Changes
- Change 1 description

### 📝 Notes
- Additional information
```