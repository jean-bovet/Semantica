"""
Simplified setup script for copying Python files
This creates a standalone Python module directory instead of using py2app
"""

import os
import shutil
from pathlib import Path

def setup_python_bundle():
    """Copy Python source files and create a simple bundle"""
    
    # Source and destination directories
    source_dir = Path("../local-doc-search/src")
    dest_dir = Path("LocalDocSearch/python_src")
    
    # Create destination directory
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    # Copy all Python files
    for py_file in source_dir.glob("*.py"):
        shutil.copy2(py_file, dest_dir)
        print(f"Copied {py_file.name}")
    
    # Copy config file
    config_source = Path("../local-doc-search/config.yaml")
    if config_source.exists():
        shutil.copy2(config_source, dest_dir)
        print("Copied config.yaml")
    
    # Create __init__.py if it doesn't exist
    init_file = dest_dir / "__init__.py"
    if not init_file.exists():
        init_file.touch()
        print("Created __init__.py")
    
    print(f"\n✓ Python sources prepared in {dest_dir}")
    return True

if __name__ == "__main__":
    success = setup_python_bundle()
    if success:
        print("\nNext steps:")
        print("1. The Python files are ready in LocalDocSearch/python_src/")
        print("2. Build the Swift app with: swift build -c release")
        print("3. Create the app bundle manually")
    else:
        print("\nError: Failed to set up Python bundle")
        exit(1)