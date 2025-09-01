# Release Notes & Process

## 🚀 Quick Release

```bash
./scripts/release.sh v1.0.1
```

That's it! The script handles everything.

## 📝 How to Release

### 1. Create Release Notes
Create a markdown file in this folder named `vX.X.X.md`:

```bash
# Example for v1.0.2
nano releases/v1.0.2.md
```

Use this template:
```markdown
# Semantica vX.X.X

## What's New

### 🚀 Features
- New feature description

### 🐛 Bug Fixes
- Bug fix description

### 💪 Improvements
- Performance improvement

## How to Update
Semantica will automatically notify you of this update. Simply click "Update" when prompted.

Your existing document index and settings will be preserved during the update.
```

### 2. Run Release Script
```bash
# Works with or without 'v' prefix
./scripts/release.sh v1.0.2
# or
./scripts/release.sh 1.0.2
```

The script will:
1. ✅ Update package.json version
2. ✅ Commit and tag the release
3. ✅ Build the macOS application
4. ✅ Create GitHub release with your notes
5. ✅ Upload all files for auto-update
6. ✅ Users get notified within 30 minutes

## 📁 File Structure

- `vX.X.X.md` - User-facing release notes (required)
- `vX.X.X-detailed.md` - Technical changelog (optional)

## 🔧 Prerequisites

```bash
# Install GitHub CLI (one time only)
brew install gh
gh auth login
```

## 🐛 Troubleshooting

**"Uncommitted changes"** - Commit or stash your changes first

**"Tag already exists"** - Script will ask if you want to recreate it

**"Build failed"** - Try: `rm -rf dist dist-app && npm run dist:mac`

## 📋 Version History

- **v1.0.1** - 2x Performance Improvement (Jan 2, 2025)
- **v1.0.0** - Initial Release