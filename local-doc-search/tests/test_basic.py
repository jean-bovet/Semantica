#!/usr/bin/env python3
"""
Basic tests that check if the project structure is correct.
These tests work without any external dependencies.
"""
import sys
import os
import unittest
from pathlib import Path

# Add paths
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))


class TestProjectStructure(unittest.TestCase):
    """Test that the project has the correct structure."""
    
    def test_cli_file_exists(self):
        """Test that cli.py exists."""
        cli_path = Path(__file__).parent.parent / "cli.py"
        self.assertTrue(cli_path.exists(), f"cli.py not found at {cli_path}")
    
    def test_src_directory_exists(self):
        """Test that src directory exists."""
        src_path = Path(__file__).parent.parent / "src"
        self.assertTrue(src_path.exists(), f"src directory not found at {src_path}")
    
    def test_required_modules_exist(self):
        """Test that required Python modules exist."""
        modules = [
            "src/document_processor.py",
            "src/embeddings.py",
            "src/indexer.py",
            "src/search.py",
            "src/metadata_store.py"
        ]
        
        base_path = Path(__file__).parent.parent
        for module in modules:
            module_path = base_path / module
            self.assertTrue(module_path.exists(), f"Module {module} not found")
    
    def test_imports_work(self):
        """Test that basic imports work (without external dependencies)."""
        try:
            # These imports should work if paths are correct
            import src
            self.assertTrue(True, "Import of src package works")
        except ImportError as e:
            self.fail(f"Failed to import src: {e}")
    
    def test_config_file_exists(self):
        """Test that config.yaml exists."""
        config_path = Path(__file__).parent.parent / "config.yaml"
        self.assertTrue(config_path.exists(), f"config.yaml not found at {config_path}")
    
    def test_requirements_file_exists(self):
        """Test that requirements.txt exists."""
        req_path = Path(__file__).parent.parent / "requirements.txt"
        self.assertTrue(req_path.exists(), f"requirements.txt not found at {req_path}")


class TestDependencyCheck(unittest.TestCase):
    """Check if required dependencies are installed."""
    
    def test_check_dependencies(self):
        """Check which dependencies are available."""
        dependencies = {
            'numpy': False,
            'faiss': False,
            'sentence_transformers': False,
            'PyPDF2': False,
            'docx': False,
            'chardet': False,
            'rich': False,
            'click': False
        }
        
        for dep in dependencies:
            try:
                __import__(dep)
                dependencies[dep] = True
            except ImportError:
                pass
        
        print("\n=== Dependency Status ===")
        for dep, installed in dependencies.items():
            status = "✅ Installed" if installed else "❌ Not installed"
            print(f"{dep:20} {status}")
        
        # This test always passes, just reports status
        self.assertTrue(True)


if __name__ == "__main__":
    print("Running basic project structure tests...")
    print("=" * 50)
    unittest.main(verbosity=2)