# Release Checklist

Use this checklist when preparing a new release of Semantica.

## Pre-Release

### Code Preparation
- [ ] All tests passing: `npm test`
- [ ] No ESLint errors: `npm run lint` (if configured)
- [ ] Version bumped in `package.json`
- [ ] Version bumped in `app/package.json`
- [ ] CHANGELOG.md updated with release notes
- [ ] README.md updated if needed
- [ ] Documentation updated in `/specs` if needed

### Security Check
- [ ] No sensitive data in code
- [ ] No API keys or credentials
- [ ] `.env.local` is NOT committed
- [ ] Dependencies updated: `npm update`
- [ ] Security audit clean: `npm audit`

## Build & Sign

### Setup (First Time Only)
- [ ] Apple Developer account active
- [ ] Developer ID certificate installed
- [ ] `.env.local` created with credentials
- [ ] `@electron/notarize` installed

### Build Process
- [ ] Source credentials: `source .env.local`
- [ ] Run build: `./scripts/build-signed.sh`
- [ ] Build completes without errors
- [ ] DMG file created in `dist-app/`
- [ ] Code signature verified
- [ ] Notarization completed (5-30 minutes)

## Testing

### Installation Test
- [ ] Test on macOS Monterey (12.0+)
- [ ] Test on Intel Mac
- [ ] Test on Apple Silicon Mac
- [ ] Gatekeeper accepts the app
- [ ] App launches without security warnings
- [ ] "Show in Finder" context menu works

### Functionality Test
- [ ] Model downloads on first launch
- [ ] File indexing works
- [ ] Search returns results
- [ ] Settings can be changed
- [ ] Re-indexing works
- [ ] Memory usage is stable

### Update Test (if applicable)
- [ ] Auto-updater detects new version
- [ ] Update downloads successfully
- [ ] Update installs correctly
- [ ] App restarts with new version

## Distribution

### GitHub Release
- [ ] Create git tag: `git tag -a v1.0.0 -m "Version 1.0.0"`
- [ ] Push tag: `git push origin v1.0.0`
- [ ] Create GitHub release
- [ ] Upload `.dmg` file
- [ ] Upload `.zip` file (optional)
- [ ] Write release notes
- [ ] Mark as pre-release if beta

### Release Notes Template
```markdown
## What's New in v1.0.0

### ✨ Features
- Feature 1
- Feature 2

### 🐛 Bug Fixes
- Fix 1
- Fix 2

### 🔧 Improvements
- Improvement 1
- Improvement 2

### 📦 Installation
1. Download the .dmg file below
2. Open the .dmg and drag to Applications
3. Launch from Applications folder

### 🔒 Security
This release is signed and notarized by Apple.

### 💻 System Requirements
- macOS 12.0 (Monterey) or later
- Apple Silicon or Intel processor
- 2GB free disk space
```

## Post-Release

### Monitoring
- [ ] Check crash reports (if configured)
- [ ] Monitor GitHub issues
- [ ] Check download statistics
- [ ] Gather user feedback

### Documentation
- [ ] Update website/landing page
- [ ] Update installation docs
- [ ] Tweet/post about release
- [ ] Update Homebrew formula (if applicable)

### Next Version
- [ ] Create new branch for next version
- [ ] Update version to next development version
- [ ] Start CHANGELOG for next release

## Troubleshooting

### Build Failures
- Check Xcode is installed: `xcode-select --install`
- Verify certificates: `security find-identity -v -p codesigning`
- Check electron-builder logs in `dist-app/builder-debug.yml`

### Notarization Issues
- Check credentials are correct
- Verify app-specific password is valid
- Check Apple Developer account is active
- Review notarization log: `xcrun notarytool log`

### Distribution Issues
- Ensure DMG is not corrupted during upload
- Test download link works
- Verify file permissions are correct

## Emergency Rollback

If critical issues found:
1. Delete GitHub release
2. Delete git tag: `git tag -d v1.0.0` and `git push origin :refs/tags/v1.0.0`
3. Post announcement about rollback
4. Fix issues
5. Re-release with new patch version