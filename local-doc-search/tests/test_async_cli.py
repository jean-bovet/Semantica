"""
Tests for the async CLI - focusing on essential functionality without over-mocking.
"""
import asyncio
import json
import sys
import os
from pathlib import Path
import tempfile
import pytest

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from cli import AsyncSearchCLI


@pytest.fixture
def cli():
    """Create a CLI instance for testing."""
    async def _create_cli():
        cli_instance = AsyncSearchCLI()
        await cli_instance.initialize()
        return cli_instance
    
    return asyncio.run(_create_cli())


class TestAsyncCLI:
    """Test the async CLI with real components where possible."""
    
    @pytest.mark.asyncio
    async def test_initialization(self, cli):
        """Test that CLI initializes with search engine."""
        assert cli.search_engine is not None
        assert cli.executor is not None
        assert cli.indexing_status["is_indexing"] is False
    
    @pytest.mark.asyncio
    async def test_process_stats_command(self, cli):
        """Test stats command returns index statistics."""
        result = await cli.process_command('{"action": "stats"}')
        
        assert result is not None
        assert result["success"] is True
        assert result["action"] == "stats"
        assert "stats" in result
        assert "total_documents" in result["stats"]
        assert "total_chunks" in result["stats"]
        assert "index_size" in result["stats"]
    
    @pytest.mark.asyncio
    async def test_process_invalid_json(self, cli):
        """Test handling of invalid JSON input."""
        result = await cli.process_command('not valid json')
        
        assert result is not None
        assert result["success"] is False
        assert "Invalid JSON" in result["error"]
    
    @pytest.mark.asyncio
    async def test_process_unknown_action(self, cli):
        """Test handling of unknown action."""
        result = await cli.process_command('{"action": "unknown_action"}')
        
        assert result is not None
        assert result["success"] is False
        assert "Unknown action" in result["error"]
    
    @pytest.mark.asyncio
    async def test_search_empty_query(self, cli):
        """Test search with empty query returns empty results."""
        result = await cli.handle_search("", limit=10)
        
        assert result["success"] is True
        assert result["action"] == "search"
        assert result["results"] == []
    
    @pytest.mark.asyncio
    async def test_clear_index(self, cli):
        """Test clearing the index."""
        result = await cli.handle_clear()
        
        assert result["success"] is True
        assert result["action"] == "clear"
        
        # Stats should show empty index
        stats_result = await cli.handle_stats()
        assert stats_result["stats"]["total_documents"] == 0
        assert stats_result["stats"]["total_chunks"] == 0
    
    @pytest.mark.asyncio
    async def test_concurrent_operations(self, cli):
        """Test that search can run while status is checked."""
        # Run multiple operations concurrently
        results = await asyncio.gather(
            cli.handle_search("test query", limit=5),
            cli.handle_status(),
            cli.handle_stats(),
            return_exceptions=True
        )
        
        # All should succeed
        for result in results:
            if isinstance(result, dict):
                assert result["success"] is True
    
    @pytest.mark.asyncio
    async def test_index_folder_basic(self, cli):
        """Test basic folder indexing with a small test folder."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a test file
            test_file = Path(tmpdir) / "test.txt"
            test_file.write_text("This is a test document with some content for indexing.")
            
            # Index the folder
            result = await cli.handle_index(tmpdir)
            
            assert result["success"] is True
            assert result["action"] == "index"
            # Should have at least one document
            assert result["total_documents"] >= 1
            assert result["total_chunks"] >= 1
    
    @pytest.mark.asyncio
    async def test_search_after_indexing(self, cli):
        """Test that search works after indexing content."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test files
            (Path(tmpdir) / "python.txt").write_text("Python is a programming language used for data science and web development.")
            (Path(tmpdir) / "javascript.txt").write_text("JavaScript is used for web development and runs in browsers.")
            
            # Index the folder
            await cli.handle_index(tmpdir)
            
            # Search for content
            result = await cli.handle_search("programming language", limit=5)
            
            assert result["success"] is True
            assert len(result["results"]) > 0
            # Should find the Python file
            assert any("python" in r["file_name"].lower() for r in result["results"])
    
    @pytest.mark.asyncio 
    async def test_exit_command(self, cli):
        """Test exit command sets the exit flag."""
        result = await cli.process_command('{"action": "exit"}')
        
        assert result["success"] is True
        assert result["action"] == "exit"
        assert cli.should_exit is True


if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v"])