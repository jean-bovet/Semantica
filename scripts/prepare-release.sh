#!/bin/bash
# Semantica Release Preparation Script
# Usage: ./scripts/prepare-release.sh v1.0.5

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Check version argument
if [ -z "$1" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 v1.0.5"
    exit 1
fi

VERSION_INPUT="$1"
VERSION="${VERSION_INPUT#v}"
VERSION_TAG="v${VERSION}"

print_step "Preparing Release Notes for ${VERSION_TAG}"

# Get last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

if [ -z "$LAST_TAG" ]; then
    echo "No previous tags found, showing all commits"
    COMMITS=$(git log --oneline --no-merges)
else
    echo "Last tag: ${LAST_TAG}"
    COMMITS=$(git log ${LAST_TAG}..HEAD --oneline --no-merges)
fi

# Count commits
COMMIT_COUNT=$(echo "$COMMITS" | grep -c "^" || echo "0")
echo "Commits since ${LAST_TAG}: ${COMMIT_COUNT}"
echo

# Create release notes file
RELEASE_NOTES_FILE="releases/${VERSION_TAG}.md"

if [ -f "$RELEASE_NOTES_FILE" ]; then
    echo "Warning: ${RELEASE_NOTES_FILE} already exists"
    read -p "Overwrite? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

mkdir -p releases

# Generate template with commit hints
cat > "$RELEASE_NOTES_FILE" << EOF
# Semantica ${VERSION_TAG}

## What's New

### 🚀 Features
- [Add new features here]

### 🐛 Bug Fixes
- [Add bug fixes here]

### 💪 Improvements
- [Add improvements here]

## Notes
[Optional: Add any important notes, warnings, or context]

---
<!-- Recent commits for reference:
${COMMITS}
-->
EOF

echo -e "${GREEN}✅ Created ${RELEASE_NOTES_FILE}${NC}"
echo
echo "Next steps:"
echo "1. Edit ${RELEASE_NOTES_FILE}"
echo "2. Review and clean up the commit list at the bottom"
echo "3. Run: npm run release:tag ${VERSION_TAG}"
echo
