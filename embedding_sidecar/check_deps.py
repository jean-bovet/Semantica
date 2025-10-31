#!/usr/bin/env python3
"""
Dependency check script for Semantica Python sidecar

Quickly checks if all required Python dependencies are installed.
Exits with code 0 if all dependencies are present, code 1 if any are missing.
Outputs JSON with detailed status for Electron to parse.

Usage:
    python3 check_deps.py

Output:
    {
        "all_present": true/false,
        "python_version": "3.11.6",
        "deps": {
            "fastapi": true/false,
            "uvicorn": true/false,
            ...
        },
        "missing": ["package1", "package2", ...]
    }
"""

import sys
import json
import importlib.util

# Required dependencies
REQUIRED_DEPS = [
    'fastapi',
    'uvicorn',
    'pydantic',
    'sentence_transformers',
    'torch',
    'pypdf'
]

def check_dependencies():
    """Check if all required dependencies are installed"""
    deps_status = {}
    missing = []

    for dep in REQUIRED_DEPS:
        try:
            spec = importlib.util.find_spec(dep)
            if spec is not None:
                deps_status[dep] = True
            else:
                deps_status[dep] = False
                missing.append(dep)
        except (ImportError, ModuleNotFoundError, ValueError):
            deps_status[dep] = False
            missing.append(dep)

    all_present = len(missing) == 0

    # Get Python version
    python_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"

    result = {
        'all_present': all_present,
        'python_version': python_version,
        'deps': deps_status,
        'missing': missing
    }

    return result

if __name__ == '__main__':
    try:
        result = check_dependencies()
        print(json.dumps(result))
        sys.exit(0 if result['all_present'] else 1)
    except Exception as e:
        # If something goes wrong, return error JSON
        error_result = {
            'all_present': False,
            'error': str(e),
            'python_version': f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        }
        print(json.dumps(error_result))
        sys.exit(1)
