# Auto-Update Deployment Guide

*Previous: [08-startup-flow.md](./08-startup-flow.md)*

---

## Implementation Status

✅ **Minimal auto-update has been implemented** using the 2-line electron-updater approach.

## What Was Implemented

### 1. Dependencies
- **electron-updater** v6.6.2 - Auto-update functionality
- **electron-log** v5.4.3 - Logging and debugging

### 2. Core Implementation
**File**: `src/main/main.ts` (lines 174-188)

```typescript
// Configure auto-updater logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');

// Initialize auto-updater after a short delay
setTimeout(() => {
  log.info('Checking for updates...');
  autoUpdater.checkForUpdatesAndNotify();
}, 5000); // 5 second delay to let app fully load

// Check for updates every 30 minutes
setInterval(() => {
  autoUpdater.checkForUpdatesAndNotify();
}, 30 * 60 * 1000);
```

### 3. Configuration Files

#### Entitlements (`build/entitlements.mac.plist`)
Required macOS permissions for code signing and network access.

#### Package.json Updates
- **Publish configuration**: Points to GitHub releases
- **Build scripts**: Added for different platforms
- **App ID**: `ch.arizona-software.semantica`

#### Development Testing (`dev-app-update.yml`)
Enables testing update UI without publishing releases.

## Deployment Instructions

### Prerequisites

#### 1. Apple Developer Account (macOS)
- [ ] Active Apple Developer account ($99/year)
- [ ] Developer ID Application certificate installed
- [ ] App-specific password generated at appleid.apple.com

#### 2. Environment Variables
Ensure `.env.local` contains:
```bash
APPLE_ID=your-apple-id@email.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=YOUR_TEAM_ID
CSC_NAME="Developer ID Application: Your Name (TEAMID)"
```

#### 3. GitHub Token
For publishing releases:
```bash
export GH_TOKEN=your-github-personal-access-token
```

### Testing Locally

#### 1. Test Update UI During Development
```bash
# The dev-app-update.yml file enables testing
npm run dev

# Check logs for update checks
tail -f ~/Library/Logs/Semantica/main.log
```

#### 2. Verify Auto-Updater Initialization
Look for these log messages:
- "App starting..."
- "Checking for updates..."
- "No update available" or "Update available"

### Building for Release

#### 1. Update Version Number
**File**: `package.json`
```json
{
  "version": "1.0.1"  // Increment from current version
}
```

#### 2. Build Signed Application
```bash
# For macOS (includes signing and notarization)
npm run dist:mac

# For Windows
npm run dist:win

# For Linux
npm run dist:linux
```

Output location: `dist-app/`

#### 3. Verify Signing (macOS)
```bash
# Check code signature
codesign -dv --verbose=4 dist-app/Semantica.app

# Check notarization
spctl -a -vvv -t install dist-app/Semantica.app
```

### Publishing a Release

#### Method 1: Automatic via npm script
```bash
# Builds and publishes to GitHub in one step
npm run release
```

#### Method 2: Manual GitHub Release
1. Create and push a git tag:
```bash
git tag v1.0.1
git push origin v1.0.1
```

2. Create GitHub release:
- Go to https://github.com/bovet/FSS/releases
- Click "Draft a new release"
- Select your tag
- Upload files from `dist-app/`:
  - `Semantica-1.0.1.dmg`
  - `Semantica-1.0.1.dmg.blockmap`
  - `latest-mac.yml`

3. Publish release (not as draft)

### Verifying Auto-Update

#### 1. Install Previous Version
Install the current production version of the app.

#### 2. Check Update Detection
- Launch the app
- Wait 5 seconds
- Check Menu → Semantica → Check for Updates (if implemented)
- Or check logs: `~/Library/Logs/Semantica/main.log`

#### 3. Expected Behavior
- Background download starts automatically
- Native macOS notification appears when ready
- Click notification or restart app to apply update

### Troubleshooting

#### Update Not Detected
1. **Check version numbers**: Release version must be > installed version
2. **Verify release is published**: Not in draft state on GitHub
3. **Check logs**: `~/Library/Logs/Semantica/main.log`
4. **Network access**: Ensure firewall allows HTTPS to github.com

#### Signing Issues (macOS)
```bash
# Verify certificate is valid
security find-identity -v -p codesigning

# Check certificate in keychain
security find-certificate -a -p -c "Developer ID Application"
```

#### Common Log Messages
- `Checking for update` - Update check initiated
- `Update for version X.X.X is not available` - No newer version
- `Found version X.X.X` - Update available
- `Downloading update` - Download in progress
- `Update downloaded` - Ready to install

### User Experience

#### What Users See
1. **Nothing initially** - Updates check silently
2. **Native notification** - "A new update is ready to install"
3. **Install options**:
   - Click notification → Immediate restart and update
   - Ignore → Update installs on next app quit
   - Do nothing → Update waits patiently

#### Update Frequency
- **On launch**: 5 seconds after startup
- **Periodic**: Every 30 minutes while running
- **Manual**: User can check via menu (if implemented)

### Monitoring Updates

#### GitHub Insights
- View download counts on release page
- Track adoption rate over time
- Monitor asset download patterns

#### Application Logs
Default log locations:
- **macOS**: `~/Library/Logs/Semantica/main.log`
- **Windows**: `%USERPROFILE%\AppData\Roaming\Semantica\logs\main.log`
- **Linux**: `~/.config/Semantica/logs/main.log`

### Security Considerations

#### Code Signing
- **Required**: macOS requires signed apps for auto-update
- **Verification**: electron-updater verifies signatures
- **Certificate**: Must use Developer ID Application cert

#### Update Integrity
- File checksums validated automatically
- HTTPS-only downloads from GitHub
- Signature verification before installation

### Rollback Plan

If an update causes issues:

1. **Disable auto-update temporarily**:
```typescript
// Comment out in main.ts
// autoUpdater.checkForUpdatesAndNotify();
```

2. **Create patch release**:
- Fix the issue
- Increment version
- Release immediately

3. **Direct users to manual download** if needed:
- Provide direct DMG download link
- Instructions to replace app manually

### Future Enhancements

These features can be added based on user feedback:

1. **Update menu item** - Manual check option
2. **Release notes** - Display what's new
3. **Update preferences** - User control over auto-update
4. **Progress indicator** - Download progress in UI
5. **Staged rollouts** - Percentage-based deployment

See [`planning/auto-update-implementation.md`](../planning/auto-update-implementation.md) for full feature documentation.

## Checklist for First Release

- [ ] Version bumped in package.json
- [ ] Changelog updated
- [ ] Code signed and notarized (macOS)
- [ ] Local update test successful
- [ ] GitHub token configured
- [ ] Release published (not draft)
- [ ] Update detected from previous version
- [ ] Download completes successfully
- [ ] Installation works correctly
- [ ] Logs show no errors

## Success Metrics

Track these after first release:
- **Adoption rate**: % on latest version after 1 week
- **Download success**: Completed vs failed downloads  
- **Update errors**: Error rate from logs
- **User feedback**: Support tickets about updates
- **Time to update**: Average time from release to install

---

*Implementation Date: August 2025*  
*Status: ✅ Implemented and ready for deployment*