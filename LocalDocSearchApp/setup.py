"""
Setup script for bundling Python search engine with py2app
"""

from setuptools import setup
import os
import shutil
from pathlib import Path

# Copy Python source files from the CLI project
def copy_python_sources():
    source_dir = Path("../local-doc-search/src")
    dest_dir = Path("LocalDocSearch/python_src")
    
    # Create destination directory
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    # Copy all Python files
    for py_file in source_dir.glob("*.py"):
        shutil.copy2(py_file, dest_dir)
    
    # Create __init__.py if it doesn't exist
    (dest_dir / "__init__.py").touch()
    
    print(f"Copied Python sources to {dest_dir}")

# Run the copy before setup
copy_python_sources()

APP = ['LocalDocSearch/python_src/search.py']
DATA_FILES = []
OPTIONS = {
    'packages': [
        'numpy',
        'faiss',
        'sentence_transformers',
        'torch',
        'transformers',
        'langchain',
        'langchain_community',
        'PyPDF2',
        'docx',
        'chardet',
        'yaml',
        'tqdm',
        'ollama',
    ],
    'includes': [
        'document_processor',
        'embeddings',
        'indexer',
    ],
    'frameworks': [],
    'resources': ['LocalDocSearch/python_src'],
    'plist': {
        'CFBundleName': 'LocalDocSearch Python Engine',
        'CFBundleVersion': '1.0.0',
        'PyRuntimeLocations': [
            '@executable_path/../Frameworks/Python.framework/Versions/3.11/Python',
            '/System/Library/Frameworks/Python.framework/Versions/3.11/Python'
        ]
    },
    'bdist_base': 'build',
    'dist_dir': 'LocalDocSearch/Resources',
    'compressed': True,
    'optimize': 2,
    'arch': 'universal2',  # Build for both Intel and Apple Silicon
    'semi_standalone': False,
    'site_packages': True,
}

setup(
    name='LocalDocSearchEngine',
    app=APP,
    data_files=DATA_FILES,
    options={'py2app': OPTIONS},
    setup_requires=['py2app'],
    version='1.0.0',
    description='Python search engine for LocalDocSearch app',
    author='Your Name',
    python_requires='>=3.9',
)