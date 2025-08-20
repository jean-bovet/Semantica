#!/usr/bin/env python3
"""
Standalone CLI that works with default macOS Python
Automatically installs dependencies if needed
"""

import os
import sys
import subprocess
import json
from pathlib import Path

def get_app_venv_dir():
    """Get the virtual environment directory"""
    home = Path.home()
    app_dir = home / "Library" / "Application Support" / "FinderSemanticSearch"
    app_dir.mkdir(parents=True, exist_ok=True)
    return app_dir / "venv"

def ensure_dependencies():
    """Ensure all dependencies are installed"""
    venv_dir = get_app_venv_dir()
    
    # Create venv if it doesn't exist
    if not venv_dir.exists():
        print(json.dumps({"status": "installing", "message": "Creating Python environment..."}), file=sys.stderr)
        sys.stderr.flush()
        subprocess.run([sys.executable, "-m", "venv", str(venv_dir)], check=True)
    
    # Check if dependencies are installed
    marker_file = venv_dir / "deps_installed.txt"
    if not marker_file.exists():
        print(json.dumps({"status": "installing", "message": "Installing dependencies (first time only)..."}), file=sys.stderr)
        sys.stderr.flush()
        
        pip_path = venv_dir / "bin" / "pip"
        
        # Upgrade pip first
        subprocess.run([str(pip_path), "install", "--upgrade", "pip"], 
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        # Required packages
        packages = [
            "click",
            "rich",
            "pyyaml", 
            "numpy",
            "faiss-cpu",
            "sentence-transformers",
            "PyPDF2",  # Changed from pypdf to PyPDF2
            "python-docx",
            "chardet",
            "tqdm",
        ]
        
        for package in packages:
            print(json.dumps({"status": "installing", "message": f"Installing {package}..."}), file=sys.stderr)
            sys.stderr.flush()
            subprocess.run([str(pip_path), "install", "--quiet", package], check=True)
        
        marker_file.write_text("1")
        print(json.dumps({"status": "ready", "message": "Dependencies ready"}), file=sys.stderr)
        sys.stderr.flush()
    else:
        # Dependencies already installed
        print(json.dumps({"status": "ready", "message": "Dependencies ready"}), file=sys.stderr)
        sys.stderr.flush()
    
    return venv_dir

def run_cli_with_venv(venv_dir, args):
    """Run the CLI with the virtual environment"""
    python_path = venv_dir / "bin" / "python"
    
    # Import path for the CLI
    cli_dir = Path(__file__).parent
    
    # Set up environment
    env = os.environ.copy()
    env["VIRTUAL_ENV"] = str(venv_dir)
    env["PATH"] = f"{venv_dir / 'bin'}:{env.get('PATH', '')}"
    env["PYTHONPATH"] = str(cli_dir)
    
    # Run the actual CLI
    cmd = [str(python_path), "-c", """
import sys
sys.path.insert(0, '""" + str(cli_dir) + """')
from cli import cli
cli()
"""] + args
    
    process = subprocess.Popen(
        cmd,
        stdin=sys.stdin,
        stdout=sys.stdout, 
        stderr=sys.stderr,
        env=env
    )
    
    return process.wait()

def main():
    """Main entry point"""
    try:
        # Ensure dependencies are installed
        venv_dir = ensure_dependencies()
        
        # Run the CLI
        return run_cli_with_venv(venv_dir, sys.argv[1:])
        
    except KeyboardInterrupt:
        return 0
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())