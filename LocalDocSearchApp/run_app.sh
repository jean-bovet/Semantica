#!/bin/bash

echo "=========================================="
echo "LocalDocSearch SwiftUI App Launcher"
echo "=========================================="

# Set Python environment
export PYTHONPATH="/Users/bovet/GitHub/FSS/local-doc-search/src:$PYTHONPATH"
export PYTHONHOME="$(python3 -c 'import sys; print(sys.prefix)')"

# Run the SwiftUI app
echo "Launching SwiftUI app..."
.build/debug/LocalDocSearch