# Minimal Auto-Update Implementation for Semantica

## Overview

This document outlines the **minimal viable implementation** of auto-update for Semantica using the 2-line electron-updater approach. Advanced features are documented separately for future implementation.

**Approach**: Start simple, expand later based on user feedback.

## Why Minimal First?

- **Faster to ship**: Can be implemented in 1-2 days vs 4 weeks
- **Proven to work**: This is how many Electron apps start
- **User testing**: Learn what users actually need before building complex features
- **Less bugs**: Fewer moving parts = more reliable
- **Native experience**: Uses OS notifications that users already understand

## Phase 1: Minimal Implementation (1-2 days)

### Step 1: Install Dependencies
```bash
npm install --save electron-updater
npm install --save-dev electron-log
```

### Step 2: Add Auto-Update Code
**File**: `src/main/main.ts`

Add these lines after app initialization:
```typescript
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

// Configure logging for debugging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');

app.whenReady().then(async () => {
  // ... existing window creation code ...
  
  // Start auto-updater after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 5000); // 5 second delay to let app fully load
  
  // Check for updates every 30 minutes
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 30 * 60 * 1000);
});
```

### Step 3: Configure Build Settings
**File**: `package.json`

```json
{
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
      "entitlementsInherit": "build/entitlements.mac.plist"
    }
  }
}
```

### Step 4: Create Entitlements File
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
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
```

### Step 5: Set Up Code Signing (Required for macOS)

Create `.env.local` with your Apple credentials:
```bash
APPLE_ID=your-apple-id@email.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=YOUR_TEAM_ID
CSC_NAME="Developer ID Application: Your Name (TEAMID)"
```

### Step 6: Build & Publish

```bash
# Build the app
npm run build

# Create signed and notarized distribution
npm run dist

# Publish to GitHub (creates release and uploads artifacts)
npm run release
```

## What Users Will Experience

1. **App checks for updates** automatically on launch and every 30 minutes
2. **If update found**, downloads silently in background
3. **When ready**, shows native OS notification: "A new update is ready to install"
4. **User can**:
   - Click notification → app restarts with update
   - Ignore → update installs next time they quit
   - Do nothing → update waits patiently

## Testing During Development

Create `dev-app-update.yml` in project root:
```yaml
owner: bovet
repo: FSS
provider: github
updaterCacheDirName: semantica-updater
```

This allows testing the update UI without publishing releases.

## Deployment Checklist

- [ ] Apple Developer account active ($99/year)
- [ ] Developer ID Application certificate installed
- [ ] Environment variables configured
- [ ] Version bumped in package.json
- [ ] GitHub personal access token configured (for publishing)
- [ ] Test update from previous version

## What This Doesn't Do (Yet)

- No custom update UI
- No download progress bar
- No release notes display
- No ability to skip updates
- No manual check button
- No update preferences

**These features are documented in `auto-update-implementation.md` for Phase 2.**

## Troubleshooting

### Logs Location
- **macOS**: `~/Library/Logs/Semantica/main.log`
- **Windows**: `%USERPROFILE%\AppData\Roaming\Semantica\logs\main.log`

### Common Issues

**Updates not working on macOS:**
- Check app is signed: `codesign -dv --verbose=4 /Applications/Semantica.app`
- Check notarization: `spctl -a -vvv -t install /Applications/Semantica.app`

**No update notifications:**
- Check logs for "Checking for update"
- Verify GitHub release is published (not draft)
- Ensure version in release > installed version

## Success Metrics

Track these after launch:
- Update adoption rate (via GitHub release download stats)
- Support tickets about updates
- User feedback on update experience

## Next Steps

Once minimal auto-update is working and stable:
1. Gather user feedback
2. Identify most requested features
3. Implement Phase 2 features incrementally

## Timeline

| Task | Time | Status |
|------|------|--------|
| Install dependencies | 30 min | Pending |
| Add update code | 1 hour | Pending |
| Configure build | 1 hour | Pending |
| Test locally | 2 hours | Pending |
| Code signing setup | 2 hours | Pending |
| First release test | 2 hours | Pending |
| **Total** | **~1 day** | |

## Conclusion

This minimal implementation provides 80% of the value with 20% of the complexity. Users get automatic updates with native OS integration, while we avoid the complexity of custom UI and preferences. Perfect for v1.