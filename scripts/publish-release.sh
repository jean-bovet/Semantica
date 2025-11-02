#!/bin/bash
# Semantica Publish Release Script
# Usage: ./scripts/publish-release.sh v1.0.5

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step() {
    echo
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_error() {
    echo -e "${RED}❌ Error: $1${NC}"
}

# Check version argument
if [ -z "$1" ]; then
    print_error "No version provided"
    echo "Usage: $0 <version>"
    echo "Example: $0 v1.0.5"
    exit 1
fi

VERSION_INPUT="$1"
VERSION="${VERSION_INPUT#v}"
VERSION_TAG="v${VERSION}"

print_step "Publishing Release ${VERSION_TAG}"

# Check gh CLI
if ! command -v gh &> /dev/null; then
    print_error "GitHub CLI (gh) not installed"
    echo "Install: brew install gh"
    exit 1
fi

# Check tag exists
if ! git rev-parse "$VERSION_TAG" >/dev/null 2>&1; then
    print_error "Tag ${VERSION_TAG} does not exist locally"
    echo "Run: npm run release:tag ${VERSION_TAG}"
    exit 1
fi

# Check release notes
RELEASE_NOTES_FILE="releases/${VERSION_TAG}.md"
if [ ! -f "$RELEASE_NOTES_FILE" ]; then
    print_error "Release notes not found: ${RELEASE_NOTES_FILE}"
    exit 1
fi

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)

echo "Branch: ${CURRENT_BRANCH}"
echo "Tag:    ${VERSION_TAG}"
echo "Notes:  ${RELEASE_NOTES_FILE}"
echo

read -p "Push and publish? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 0
fi

# Push branch and tag
print_step "Pushing to GitHub"
git push origin "$CURRENT_BRANCH"
git push origin "$VERSION_TAG"
echo -e "${GREEN}✅ Pushed branch and tag${NC}"

# Build
print_step "Building Application"
echo "Cleaning dist-app..."
rm -rf dist-app/*

npm run dist:mac
echo -e "${GREEN}✅ Build complete${NC}"

# Find files
DMG_FILE=$(find dist-app -name "*${VERSION}*.dmg" -type f | head -1)
ZIP_FILE=$(find dist-app -name "*${VERSION}*.zip" -type f | head -1)
BLOCKMAP_DMG_FILE=$(find dist-app -name "*${VERSION}*.dmg.blockmap" -type f | head -1)
BLOCKMAP_ZIP_FILE=$(find dist-app -name "*${VERSION}*.zip.blockmap" -type f | head -1)
YML_FILE=$(find dist-app -name "latest-mac.yml" -type f | head -1)

if [ -z "$DMG_FILE" ] || [ -z "$ZIP_FILE" ]; then
    print_error "Build files not found"
    ls -la dist-app/
    exit 1
fi

echo "Build files:"
echo "  • DMG:           $(basename "$DMG_FILE")"
echo "  • ZIP:           $(basename "$ZIP_FILE")"
echo "  • DMG Blockmap:  $(basename "$BLOCKMAP_DMG_FILE")"
echo "  • ZIP Blockmap:  $(basename "$BLOCKMAP_ZIP_FILE")"
echo "  • YML:           $(basename "$YML_FILE")"
echo

# Create GitHub release
print_step "Creating GitHub Release"

if gh release view "$VERSION_TAG" >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Release ${VERSION_TAG} already exists${NC}"
    read -p "Delete and recreate? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        gh release delete "$VERSION_TAG" --yes
    else
        exit 0
    fi
fi

gh release create "$VERSION_TAG" \
    --title "Semantica ${VERSION_TAG}" \
    --notes-file "$RELEASE_NOTES_FILE" \
    "$DMG_FILE" \
    "$ZIP_FILE" \
    "$BLOCKMAP_DMG_FILE" \
    "$BLOCKMAP_ZIP_FILE" \
    "$YML_FILE"

echo -e "${GREEN}✅ GitHub release created${NC}"
echo

echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}          🎉 Release ${VERSION_TAG} Published!           ${GREEN}║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
echo
echo "📦 Release URL: https://github.com/jean-bovet/Semantica/releases/tag/${VERSION_TAG}"
echo "📱 Users will receive updates within 30 minutes"
echo
