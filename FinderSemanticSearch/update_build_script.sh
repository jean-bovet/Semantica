#!/bin/bash
# Updated build script that includes async CLI files

SOURCE_DIR="${PROJECT_DIR}/../local-doc-search"
DEST_DIR="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/Resources/python_cli"

if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Python CLI source not found at $SOURCE_DIR"
    exit 1
fi

echo "Creating destination directories..."
mkdir -p "$DEST_DIR" || true
mkdir -p "$DEST_DIR/src" || true

echo "Copying Python CLI files..."
# Copy main CLI files
cp "$SOURCE_DIR/cli.py" "$DEST_DIR/" || echo "Warning: Failed to copy cli.py"
cp "$SOURCE_DIR/cli_standalone.py" "$DEST_DIR/" || echo "Warning: Failed to copy cli_standalone.py"

# Copy async CLI files (new)
cp "$SOURCE_DIR/cli_async.py" "$DEST_DIR/" || echo "Warning: Failed to copy cli_async.py"
cp "$SOURCE_DIR/cli_async_standalone.py" "$DEST_DIR/" || echo "Warning: Failed to copy cli_async_standalone.py"

# Copy config
cp "$SOURCE_DIR/config.yaml" "$DEST_DIR/" || echo "Warning: Failed to copy config.yaml"

# Copy src directory files individually
echo "Copying src/*.py files..."
for file in "$SOURCE_DIR/src/"*.py; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        cp "$file" "$DEST_DIR/src/$filename" || echo "Warning: Failed to copy $filename"
        if [ -f "$DEST_DIR/src/$filename" ]; then
            echo "  Copied: $filename"
        fi
    fi
done

echo "Python CLI copy process completed"
echo "Files in destination:"
ls -la "$DEST_DIR/" 2>/dev/null || true
echo "Files in src:"
ls -la "$DEST_DIR/src/" 2>/dev/null || true