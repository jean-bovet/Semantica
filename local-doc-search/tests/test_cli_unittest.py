"""
Simple unittest-based tests for the async CLI that work with system Python.
"""
import asyncio
import json
import sys
import os
from pathlib import Path
import tempfile
import unittest

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from cli import AsyncSearchCLI


class TestAsyncCLI(unittest.TestCase):
    """Test the async CLI with unittest (no pytest needed)."""
    
    def setUp(self):
        """Set up test CLI instance."""
        self.cli = AsyncSearchCLI()
        # Run async initialization
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self.cli.initialize())
        self.loop = loop
    
    def tearDown(self):
        """Clean up."""
        self.cli.executor.shutdown(wait=True)
        self.loop.close()
    
    def test_initialization(self):
        """Test that CLI initializes with search engine."""
        self.assertIsNotNone(self.cli.search_engine)
        self.assertIsNotNone(self.cli.executor)
        self.assertFalse(self.cli.indexing_status["is_indexing"])
    
    def test_process_stats_command(self):
        """Test stats command returns index statistics."""
        result = self.loop.run_until_complete(
            self.cli.process_command('{"action": "stats"}')
        )
        
        self.assertIsNotNone(result)
        self.assertTrue(result["success"])
        self.assertEqual(result["action"], "stats")
        self.assertIn("stats", result)
    
    def test_process_invalid_json(self):
        """Test handling of invalid JSON input."""
        result = self.loop.run_until_complete(
            self.cli.process_command('not valid json')
        )
        
        self.assertIsNotNone(result)
        self.assertFalse(result["success"])
        self.assertIn("Invalid JSON", result["error"])
    
    def test_search_empty_query(self):
        """Test search with empty query returns empty results."""
        result = self.loop.run_until_complete(
            self.cli.handle_search("", limit=10)
        )
        
        self.assertTrue(result["success"])
        self.assertEqual(result["action"], "search")
        self.assertEqual(result["results"], [])
    
    def test_clear_index(self):
        """Test clearing the index."""
        result = self.loop.run_until_complete(
            self.cli.handle_clear()
        )
        
        self.assertTrue(result["success"])
        self.assertEqual(result["action"], "clear")


if __name__ == "__main__":
    # Run the tests
    unittest.main(verbosity=2)