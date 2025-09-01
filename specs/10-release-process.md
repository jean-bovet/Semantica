# Release Process Guide

*Previous: [09-auto-update-deployment.md](./09-auto-update-deployment.md)*

---

## Overview

This document defines the complete process for releasing new versions of Semantica with auto-update support.

## Prerequisites

### One-Time Setup

1. **GitHub Personal Access Token**
   - Go to GitHub → Settings → Developer settings → Personal access tokens
   - Generate new token with `repo` scope
   - Save as environment variable:
   ```bash
   export GH_TOKEN=your-github-personal-access-token
   ```

2. **Apple Developer Credentials** (in `.env.local`)
   ```bash
   APPLE_ID=your-apple-id@email.com
   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
   APPLE_TEAM_ID=YOUR_TEAM_ID
   CSC_NAME="Developer ID Application: Your Name (TEAMID)"
   ```

3. **Verify Signing Certificate**
   ```bash
   security find-identity -v -p codesigning
   ```

## Release Process

### Step 1: Prepare Release

#### 1.1 Update Version
**File**: `package.json`
```json
{
  "version": "1.0.1"  // Increment from current version
}
```

Version numbering follows semantic versioning:
- **Major** (1.0.0 → 2.0.0): Breaking changes
- **Minor** (1.0.0 → 1.1.0): New features
- **Patch** (1.0.0 → 1.0.1): Bug fixes

#### 1.2 Update Changelog
**File**: `CHANGELOG.md`
```markdown
## v1.0.1 - 2025-08-30

### ✨ New Features
- Added auto-update functionality
- Implemented resizable detail panel

### 🐛 Bug Fixes
- Fixed result view icons not displaying
- Improved memory logging to reduce spam

### 🔧 Improvements
- Native macOS elastic scrolling
- Better spacing in search results
```

#### 1.3 Test Critical Features
- [ ] Search functionality works
- [ ] File indexing works
- [ ] Settings save correctly
- [ ] UI components render properly

### Step 2: Commit and Tag

```bash
# Stage all changes
git add .

# Commit with version
git commit -m "Release v1.0.1

- Add auto-update functionality
- Fix result view with side panel
- Improve memory logging"

# Create annotated tag
git tag -a v1.0.1 -m "Release version 1.0.1"

# Push to GitHub
git push origin main
git push origin v1.0.1
```

### Step 3: Build and Publish

#### Option A: Automatic Release (Recommended)

```bash
# Ensure GitHub token is set
export GH_TOKEN=your-github-personal-access-token

# Build, sign, notarize, and publish
npm run release
```

This command will:
1. Build the application
2. Code sign the app
3. Notarize with Apple
4. Create GitHub release
5. Upload all artifacts

#### Option B: Manual Release

```bash
# Build and sign
npm run dist:mac
```

Then manually:
1. Go to https://github.com/bovet/FSS/releases
2. Click "Draft a new release"
3. Choose tag: `v1.0.1`
4. Release title: `v1.0.1`
5. Upload files from `dist-app/`:
   - `Semantica-1.0.1.dmg` (main installer)
   - `Semantica-1.0.1.dmg.blockmap` (for delta updates)
   - `latest-mac.yml` (update metadata)
6. Add release notes from CHANGELOG
7. **Publish release** (NOT as draft!)

### Step 4: Verify Release

#### 4.1 Check GitHub Release
- Visit https://github.com/bovet/FSS/releases
- Verify latest release is published
- Confirm all 3 files are attached
- Check file sizes are reasonable

#### 4.2 Test Download
```bash
# Download and verify DMG
curl -L https://github.com/bovet/FSS/releases/latest/download/Semantica-1.0.1.dmg -o test.dmg
open test.dmg
```

#### 4.3 Test Auto-Update
If you have a previous version installed:
1. Open the older version
2. Check Menu → Semantica → About (verify old version)
3. Wait 5 seconds
4. Check logs: `tail -f ~/Library/Logs/Semantica/main.log`
5. Look for "Checking for updates" and "Update available"

### Step 5: Monitor

#### 5.1 Check Download Stats
- Go to release page on GitHub
- View download count for each asset
- Monitor adoption rate

#### 5.2 Monitor Issues
- Check GitHub Issues for problems
- Monitor logs if users report issues
- Be ready to hotfix if needed

## Quick Release (After First Time)

```bash
# 1. Update version in package.json

# 2. Update CHANGELOG.md

# 3. Commit, tag, and push
git add .
git commit -m "Release v1.0.2"
git tag v1.0.2
git push origin main --tags

# 4. Build and release
npm run release
```

## Rollback Process

If a release has critical issues:

### 1. Immediate Mitigation
```bash
# Delete the release (users won't get updates)
# Go to GitHub releases → Delete release
```

### 2. Fix and Re-release
```bash
# Fix the issue
# Increment version (1.0.1 → 1.0.2)
# Follow normal release process
```

### 3. Direct Users (if needed)
Post announcement with:
- Direct download link to previous version
- Instructions to disable auto-update temporarily
- Timeline for fix

## Platform-Specific Builds

### macOS (Primary)
```bash
npm run dist:mac
```
- Requires code signing
- Requires notarization
- Outputs: DMG installer

### Windows (Future)
```bash
npm run dist:win
```
- Optional code signing
- Outputs: NSIS installer

### Linux (Future)
```bash
npm run dist:linux
```
- No code signing needed
- Outputs: AppImage

## Troubleshooting

### Build Failures

#### Signing Issues
```bash
# Verify certificate
security find-identity -v -p codesigning

# Check env variables
echo $APPLE_ID
echo $APPLE_TEAM_ID
```

#### Notarization Issues
```bash
# Check notarization status
xcrun notarytool history --apple-id $APPLE_ID --team-id $APPLE_TEAM_ID
```

### Release Issues

#### GitHub Token Problems
```bash
# Test token
curl -H "Authorization: token $GH_TOKEN" https://api.github.com/user

# Ensure token has 'repo' scope
```

#### Upload Failures
- Check network connection
- Verify file sizes (DMG should be ~100-200MB)
- Try manual upload via GitHub web UI

### Update Not Working

#### For Users
Users can check for updates manually:
1. Quit and restart app
2. Check logs at `~/Library/Logs/Semantica/main.log`
3. Download manually from GitHub if needed

#### Debug Checklist
- [ ] Version number increased?
- [ ] Release published (not draft)?
- [ ] All 3 files uploaded?
- [ ] latest-mac.yml has correct version?
- [ ] User has internet connection?

## Version History Tracking

Keep track of releases:

| Version | Date | Key Changes | Downloads |
|---------|------|-------------|-----------|
| 1.0.0 | 2025-08-29 | Initial release | - |
| 1.0.1 | 2025-08-30 | Auto-update, UI improvements | - |

## Best Practices

### Do's
- ✅ Test locally before releasing
- ✅ Keep changelog updated
- ✅ Use semantic versioning
- ✅ Monitor first 24 hours after release
- ✅ Keep release notes user-friendly

### Don'ts
- ❌ Don't skip version numbers
- ❌ Don't release on Fridays
- ❌ Don't delete old releases (breaks updates)
- ❌ Don't use draft releases
- ❌ Don't forget to push tags

## Release Checklist Template

Copy this for each release:

```markdown
## Release v1.0.X Checklist

### Pre-Release
- [ ] All tests passing
- [ ] Version updated in package.json
- [ ] CHANGELOG.md updated
- [ ] Critical features tested

### Release
- [ ] Changes committed
- [ ] Tag created and pushed
- [ ] Build successful
- [ ] Files uploaded to GitHub
- [ ] Release published

### Post-Release
- [ ] Download and test DMG
- [ ] Auto-update tested
- [ ] Release announcement posted
- [ ] Monitoring downloads
```

---

*Last Updated: August 2025*  
*Next Release: When ready*