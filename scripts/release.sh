#!/bin/bash

# Semantica Release Script
# Usage: ./scripts/release.sh v1.0.1
# The version can be with or without the 'v' prefix

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_step() {
    echo
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_error() {
    echo -e "${RED}❌ Error: $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check if version is provided
if [ -z "$1" ]; then
    print_error "No version provided"
    echo "Usage: $0 <version>"
    echo "Examples:"
    echo "  $0 1.0.1"
    echo "  $0 v1.0.1"
    exit 1
fi

# Parse version (remove 'v' prefix if present)
VERSION_INPUT="$1"
VERSION="${VERSION_INPUT#v}"  # Remove 'v' prefix if present
VERSION_TAG="v${VERSION}"     # Tag always has 'v' prefix

echo
echo -e "${BLUE}╔═══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}     ${GREEN}Semantica Release Script${NC}         ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}     Version: ${YELLOW}${VERSION}${NC}                    ${BLUE}║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════╝${NC}"

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    print_error "GitHub CLI (gh) is not installed"
    echo "Install it with: brew install gh"
    echo "Then authenticate with: gh auth login"
    exit 1
fi

# Check if we're on the correct branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "electron" ] && [ "$CURRENT_BRANCH" != "main" ]; then
    print_warning "You're on branch '$CURRENT_BRANCH' (expected 'electron' or 'main')"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    print_error "You have uncommitted changes"
    echo "Please commit or stash your changes first"
    git status --short
    exit 1
fi

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")

# Check if release notes exist
RELEASE_NOTES_FILE="releases/${VERSION_TAG}.md"
RELEASE_NOTES_DETAILED="releases/${VERSION_TAG}-detailed.md"

if [ ! -f "$RELEASE_NOTES_FILE" ]; then
    print_warning "Release notes not found at $RELEASE_NOTES_FILE"
    echo "Would you like to:"
    echo "  1) Create release notes now"
    echo "  2) Use generic release notes"
    echo "  3) Cancel release"
    read -p "Choice (1/2/3): " -n 1 -r
    echo
    
    case $REPLY in
        1)
            mkdir -p releases
            cat > "$RELEASE_NOTES_FILE" << EOF
# Semantica ${VERSION_TAG}

## What's New

### 🚀 Features
- [Add your features here]

### 🐛 Bug Fixes
- [Add your bug fixes here]

### 💪 Improvements
- [Add your improvements here]

## How to Update
Semantica will automatically notify you of this update. Simply click "Update" when prompted.

Your existing document index and settings will be preserved during the update.
EOF
            echo
            print_success "Created $RELEASE_NOTES_FILE"
            echo "Please edit the release notes and run this script again"
            exit 0
            ;;
        2)
            mkdir -p releases
            cat > "$RELEASE_NOTES_FILE" << EOF
# Semantica ${VERSION_TAG}

## What's New
- Bug fixes and performance improvements
- Enhanced stability

## How to Update
Semantica will automatically notify you of this update. Simply click "Update" when prompted.

Your existing document index and settings will be preserved during the update.
EOF
            print_success "Using generic release notes"
            ;;
        3)
            echo "Release cancelled"
            exit 0
            ;;
        *)
            print_error "Invalid choice"
            exit 1
            ;;
    esac
fi

# Show release summary
echo
print_step "📋 Release Summary"
echo "  Current version: ${CURRENT_VERSION}"
echo "  New version:     ${VERSION}"
echo "  Git tag:         ${VERSION_TAG}"
echo "  Branch:          ${CURRENT_BRANCH}"
echo "  Release notes:   ${RELEASE_NOTES_FILE}"
if [ -f "$RELEASE_NOTES_DETAILED" ]; then
    echo "  Detailed notes:  ${RELEASE_NOTES_DETAILED} ✓"
fi

# Ask for confirmation
echo
read -p "Ready to release ${VERSION_TAG}? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Release cancelled"
    exit 1
fi

# Step 1: Update version in package.json
print_step "Step 1/6: Updating package.json version"
if [ "$CURRENT_VERSION" != "$VERSION" ]; then
    npm version "$VERSION" --no-git-tag-version
    print_success "Updated package.json from ${CURRENT_VERSION} to ${VERSION}"
else
    print_success "Version already set to ${VERSION}"
fi

# Step 2: Commit version bump
print_step "Step 2/6: Committing version bump"
if git diff --quiet package.json; then
    print_success "No changes to commit (version already ${VERSION})"
else
    git add package.json
    git commit -m "chore: bump version to ${VERSION}"
    print_success "Committed version bump"
fi

# Step 3: Create and push tag
print_step "Step 3/6: Creating git tag"
if git rev-parse "$VERSION_TAG" >/dev/null 2>&1; then
    print_warning "Tag ${VERSION_TAG} already exists"
    read -p "Delete and recreate tag? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag -d "$VERSION_TAG"
        git push --delete origin "$VERSION_TAG" 2>/dev/null || true
        git tag -a "$VERSION_TAG" -m "Release ${VERSION_TAG}"
        print_success "Recreated tag ${VERSION_TAG}"
    fi
else
    git tag -a "$VERSION_TAG" -m "Release ${VERSION_TAG}"
    print_success "Created tag ${VERSION_TAG}"
fi

# Step 4: Push to remote
print_step "Step 4/6: Pushing to GitHub"
git push origin "$CURRENT_BRANCH"
git push origin "$VERSION_TAG"
print_success "Pushed branch and tag to GitHub"

# Step 5: Build application
print_step "Step 5/6: Building application"
echo "This will take a few minutes..."
npm run dist:mac
print_success "Build completed"

# Step 6: Create GitHub release
print_step "Step 6/6: Creating GitHub release"

# Find the built files
DMG_FILE=$(find dist-app -name "*.dmg" -type f | head -1)
ZIP_FILE=$(find dist-app -name "*-mac.zip" -type f | head -1)
BLOCKMAP_FILE=$(find dist-app -name "*.blockmap" -type f | head -1)
YML_FILE=$(find dist-app -name "latest-mac.yml" -type f | head -1)

if [ -z "$DMG_FILE" ]; then
    print_error "DMG file not found in dist-app/"
    echo "Build may have failed. Please check the output above."
    exit 1
fi

echo "Found release files:"
echo "  • DMG:      $(basename "$DMG_FILE")"
echo "  • ZIP:      $(basename "$ZIP_FILE")"
echo "  • Blockmap: $(basename "$BLOCKMAP_FILE")"
echo "  • YML:      $(basename "$YML_FILE")"

# Check if release already exists
if gh release view "$VERSION_TAG" >/dev/null 2>&1; then
    print_warning "Release ${VERSION_TAG} already exists on GitHub"
    read -p "Delete and recreate? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        gh release delete "$VERSION_TAG" --yes
        print_success "Deleted existing release"
    else
        echo "Release cancelled"
        exit 1
    fi
fi

# Create GitHub release with all files
echo "Creating GitHub release..."
gh release create "$VERSION_TAG" \
    --title "Semantica ${VERSION_TAG}" \
    --notes-file "$RELEASE_NOTES_FILE" \
    "$DMG_FILE" \
    "$ZIP_FILE" \
    "$BLOCKMAP_FILE" \
    "$YML_FILE"

print_success "GitHub release created"

# Final success message
echo
echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}          🎉 Release ${VERSION_TAG} Completed!            ${GREEN}║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
echo
echo "📦 Release URL: https://github.com/bovet/FSS/releases/tag/${VERSION_TAG}"
echo "📱 Users will receive update notifications within 30 minutes"
echo
echo "Next steps:"
echo "1. Check the release page to verify all files uploaded"
echo "2. Test auto-update with an older version"
echo "3. Monitor for any user-reported issues"
echo
echo "To prepare for the next release:"
echo "1. Create release notes: releases/vX.X.X.md"
echo "2. Run: ./scripts/release.sh vX.X.X"