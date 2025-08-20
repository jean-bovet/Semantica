#!/usr/bin/env python3
"""
Bootstrap script for FinderSemanticSearch
Ensures all dependencies are installed in a local environment
"""

import os
import sys
import subprocess
import json
from pathlib import Path

def get_app_support_dir():
    """Get the Application Support directory for the app"""
    home = Path.home()
    app_support = home / "Library" / "Application Support" / "FinderSemanticSearch"
    app_support.mkdir(parents=True, exist_ok=True)
    return app_support

def get_venv_path():
    """Get the path to the virtual environment"""
    return get_app_support_dir() / "venv"

def create_venv():
    """Create a virtual environment"""
    venv_path = get_venv_path()
    if not venv_path.exists():
        print(json.dumps({"status": "installing", "message": "Creating Python environment..."}))
        sys.stdout.flush()
        subprocess.run([sys.executable, "-m", "venv", str(venv_path)], check=True)
    return venv_path

def install_dependencies():
    """Install required dependencies"""
    venv_path = get_venv_path()
    pip_path = venv_path / "bin" / "pip"
    
    # Check if dependencies are already installed
    marker_file = venv_path / "deps_installed.txt"
    if marker_file.exists():
        return
    
    print(json.dumps({"status": "installing", "message": "Installing dependencies (this may take a few minutes on first run)..."}))
    sys.stdout.flush()
    
    # Required packages
    packages = [
        "click",
        "pyyaml",
        "numpy",
        "faiss-cpu",
        "sentence-transformers",
        "pypdf",
        "python-docx",
        "chardet",
        "tqdm",
    ]
    
    # Install packages
    for package in packages:
        print(json.dumps({"status": "installing", "message": f"Installing {package}..."}))
        sys.stdout.flush()
        subprocess.run([str(pip_path), "install", "--quiet", package], check=True)
    
    # Mark as installed
    marker_file.write_text("1")
    print(json.dumps({"status": "ready", "message": "Dependencies installed successfully"}))
    sys.stdout.flush()

def run_cli(args):
    """Run the actual CLI with the virtual environment"""
    venv_path = get_venv_path()
    python_path = venv_path / "bin" / "python"
    
    # Get the CLI script path (in app bundle)
    bundle_path = Path(__file__).parent
    cli_path = bundle_path / "python_cli" / "cli.py"
    
    # Run the CLI with the venv Python
    env = os.environ.copy()
    env["VIRTUAL_ENV"] = str(venv_path)
    env["PATH"] = f"{venv_path / 'bin'}:{env.get('PATH', '')}"
    
    # Execute the CLI
    process = subprocess.Popen(
        [str(python_path), str(cli_path)] + args,
        stdin=sys.stdin,
        stdout=sys.stdout,
        stderr=sys.stderr,
        env=env
    )
    
    return process.wait()

def main():
    """Main bootstrap function"""
    try:
        # Check command line arguments
        if len(sys.argv) < 2:
            print(json.dumps({"error": "No command provided"}))
            sys.exit(1)
        
        # Create venv if needed
        create_venv()
        
        # Install dependencies if needed
        install_dependencies()
        
        # Run the actual CLI
        return run_cli(sys.argv[1:])
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    sys.exit(main())