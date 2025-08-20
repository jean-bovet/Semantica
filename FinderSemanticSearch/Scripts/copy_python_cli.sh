#!/bin/bash

# Xcode Build Phase Script to copy Python CLI into app bundle
# Add this as a "Run Script" build phase in Xcode

echo "Copying Python CLI to app bundle..."

# Source directory (relative to project)
SOURCE_DIR="${PROJECT_DIR}/../../local-doc-search"

# Destination in app bundle
DEST_DIR="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/Resources/python_cli"
RESOURCES_DIR="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/Resources"

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

echo "Copying cli_standalone.py..."
cp "$SOURCE_DIR/cli_standalone.py" "$DEST_DIR/"

echo "Copying src directory..."
cp -r "$SOURCE_DIR/src" "$DEST_DIR/"

echo "Copying config.yaml..."
cp "$SOURCE_DIR/config.yaml" "$DEST_DIR/"

echo "Copying requirements.txt..."
cp "$SOURCE_DIR/requirements.txt" "$DEST_DIR/"

# Copy bootstrap script if it exists
BOOTSTRAP_PATH="${PROJECT_DIR}/FinderSemanticSearch/Resources/bootstrap.py"
if [ -f "$BOOTSTRAP_PATH" ]; then
    echo "Copying bootstrap.py..."
    cp "$BOOTSTRAP_PATH" "$RESOURCES_DIR/"
fi

# Create a marker file with version info
echo "Build date: $(date)" > "$DEST_DIR/BUILD_INFO.txt"
echo "Source: $SOURCE_DIR" >> "$DEST_DIR/BUILD_INFO.txt"

echo "Python CLI successfully copied to: $DEST_DIR"

# Optional: List what was copied
echo "Contents:"
ls -la "$DEST_DIR"