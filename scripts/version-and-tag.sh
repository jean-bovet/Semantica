#!/bin/bash
# Semantica Version and Tag Script
# Usage: ./scripts/version-and-tag.sh v1.0.5

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

print_step "Creating Tag ${VERSION_TAG}"

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    print_error "You have uncommitted changes"
    git status --short
    exit 1
fi

# Check release notes
RELEASE_NOTES_FILE="releases/${VERSION_TAG}.md"
if [ ! -f "$RELEASE_NOTES_FILE" ]; then
    print_error "Release notes not found: ${RELEASE_NOTES_FILE}"
    echo "Run: npm run release:prepare ${VERSION_TAG}"
    exit 1
fi

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")

echo "Current version: ${CURRENT_VERSION}"
echo "New version:     ${VERSION}"
echo "Release notes:   ${RELEASE_NOTES_FILE}"
echo

read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 0
fi

# Update version
if [ "$CURRENT_VERSION" != "$VERSION" ]; then
    npm version "$VERSION" --no-git-tag-version
    echo -e "${GREEN}✅ Updated package.json to ${VERSION}${NC}"
else
    echo -e "${GREEN}✅ Version already ${VERSION}${NC}"
fi

# Commit if needed
if ! git diff --quiet package.json package-lock.json 2>/dev/null; then
    git add package.json package-lock.json
    git commit -m "chore: bump version to ${VERSION}"
    echo -e "${GREEN}✅ Committed version bump${NC}"
else
    echo -e "${GREEN}✅ No version changes to commit${NC}"
fi

# Create tag
if git rev-parse "$VERSION_TAG" >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Tag ${VERSION_TAG} already exists${NC}"
    read -p "Delete and recreate? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag -d "$VERSION_TAG"
    else
        exit 0
    fi
fi

git tag -a "$VERSION_TAG" -m "Release ${VERSION_TAG}"
echo -e "${GREEN}✅ Created tag ${VERSION_TAG}${NC}"
echo

# Show tag for review
echo "Review tag:"
echo "---"
git show "$VERSION_TAG" --no-patch --format=fuller
echo "---"
echo

echo "Next steps:"
echo "1. Review the tag above"
echo "2. If OK, run: npm run release:publish ${VERSION_TAG}"
echo "3. To delete tag: git tag -d ${VERSION_TAG}"
echo
