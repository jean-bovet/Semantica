#!/bin/bash

# This script adds the Python CLI copy build phase to the Xcode project

echo "Adding Python CLI copy build phase to Xcode project..."

# Use xcodebuild to add a run script build phase
# Note: For newer Xcode projects, it's often easier to add this manually in Xcode

cat << 'EOF'

INSTRUCTIONS TO ADD BUILD PHASE MANUALLY IN XCODE:

1. Open FinderSemanticSearch.xcodeproj in Xcode
2. Select the FinderSemanticSearch target
3. Go to Build Phases tab
4. Click the + button and select "New Run Script Phase"
5. Name it "Copy Python CLI"
6. Paste the following script:

#!/bin/bash

# Copy Python CLI to app bundle
echo "Copying Python CLI to app bundle..."

# Source directory (relative to project)
SOURCE_DIR="${PROJECT_DIR}/../local-doc-search"

# Destination in app bundle
DEST_DIR="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/Resources/python_cli"

# Check if source exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Python CLI source not found at $SOURCE_DIR"
    exit 1
fi

# Create destination directory
mkdir -p "$DEST_DIR"

# Copy Python CLI files
echo "Copying cli.py..."
cp "$SOURCE_DIR/cli.py" "$DEST_DIR/"

echo "Copying src directory..."
cp -r "$SOURCE_DIR/src" "$DEST_DIR/"

echo "Copying config.yaml..."
cp "$SOURCE_DIR/config.yaml" "$DEST_DIR/"

echo "Python CLI successfully copied to: $DEST_DIR"

7. Make sure this phase runs AFTER "Sources" but BEFORE "Resources"
8. Build the project again

EOF

echo ""
echo "For now, the Python CLI has been manually copied to the current build."
echo "Please follow the instructions above to make it automatic for future builds."