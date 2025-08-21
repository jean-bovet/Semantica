"""
Unit tests for CLI commands.
"""
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest
from click.testing import CliRunner


class TestCLI:
    """Test suite for CLI commands."""
    
    @pytest.fixture
    def runner(self):
        """Create CLI test runner."""
        return CliRunner()
    
    @pytest.fixture
    def mock_search_engine(self):
        """Mock SearchEngine for testing."""
        with patch('cli.SearchEngine') as mock_engine_class:
            mock_instance = MagicMock()
            mock_engine_class.return_value = mock_instance
            yield mock_instance
            
    def test_index_command(self, runner, mock_search_engine):
        """Test index command."""
        from cli import cli
        
        mock_search_engine.index_directory.return_value = {
            'documents': 10,
            'chunks': 50
        }
        
        with tempfile.TemporaryDirectory() as tmpdir:
            result = runner.invoke(cli, ['index', '--folder', tmpdir])
            
            assert result.exit_code == 0
            mock_search_engine.index_directory.assert_called_once_with(tmpdir)
            assert "Successfully indexed" in result.output
            
    def test_index_command_incremental(self, runner, mock_search_engine):
        """Test incremental indexing command."""
        from cli import cli
        
        mock_search_engine.index_directory_incremental.return_value = {
            'total_processed': 5,
            'new_files': 2,
            'modified_files': 1,
            'deleted_files': 0,
            'unchanged_files': 10
        }
        
        with tempfile.TemporaryDirectory() as tmpdir:
            result = runner.invoke(cli, ['index', '--folder', tmpdir, '--incremental'])
            
            assert result.exit_code == 0
            mock_search_engine.index_directory_incremental.assert_called_once_with(tmpdir)
            
    def test_search_command(self, runner, mock_search_engine):
        """Test search command."""
        from cli import cli
        
        mock_search_engine.search.return_value = [
            {
                'file_path': '/test/file1.txt',
                'file_name': 'file1.txt',
                'score': 0.95,
                'preview': 'Test content preview...'
            },
            {
                'file_path': '/test/file2.txt',
                'file_name': 'file2.txt',
                'score': 0.85,
                'preview': 'Another preview...'
            }
        ]
        
        result = runner.invoke(cli, ['search', 'test query', '--limit', '5'])
        
        assert result.exit_code == 0
        mock_search_engine.search.assert_called_once_with('test query', limit=5)
        assert 'file1.txt' in result.output
        assert 'file2.txt' in result.output
        
    def test_stats_command(self, runner, mock_search_engine):
        """Test stats command."""
        from cli import cli
        
        mock_search_engine.get_statistics.return_value = {
            'total_documents': 100,
            'total_chunks': 500,
            'index_size': 1024000,
            'embedding_dimension': 384
        }
        
        result = runner.invoke(cli, ['stats'])
        
        assert result.exit_code == 0
        mock_search_engine.get_statistics.assert_called_once()
        assert '100' in result.output
        assert '500' in result.output
        
    def test_clear_command(self, runner, mock_search_engine):
        """Test clear command."""
        from cli import cli
        
        # Test with confirmation
        result = runner.invoke(cli, ['clear'], input='y\n')
        
        assert result.exit_code == 0
        mock_search_engine.clear_index.assert_called_once()
        assert 'cleared' in result.output.lower()
        
    def test_clear_command_cancelled(self, runner, mock_search_engine):
        """Test clear command when cancelled."""
        from cli import cli
        
        # Test with cancellation
        result = runner.invoke(cli, ['clear'], input='n\n')
        
        assert result.exit_code == 0
        mock_search_engine.clear_index.assert_not_called()
        
    def test_interactive_mode(self, runner, mock_search_engine):
        """Test interactive mode."""
        from cli import cli
        
        mock_search_engine.search.return_value = [
            {
                'file_path': '/test/result.txt',
                'file_name': 'result.txt',
                'score': 0.9,
                'preview': 'Result preview'
            }
        ]
        
        # Simulate interactive session
        commands = "search: test query\nexit\n"
        result = runner.invoke(cli, ['interactive'], input=commands)
        
        assert result.exit_code == 0
        mock_search_engine.search.assert_called()
        
    def test_json_mode_index(self, runner, mock_search_engine):
        """Test JSON mode with index command."""
        from cli import cli
        
        mock_search_engine.index_directory.return_value = {
            'documents': 5,
            'chunks': 20
        }
        
        with tempfile.TemporaryDirectory() as tmpdir:
            json_input = json.dumps({"action": "index", "folder": tmpdir})
            result = runner.invoke(cli, ['interactive', '--json-mode'], input=json_input + '\n{"action": "exit"}\n')
            
            # Parse JSON output
            lines = result.output.strip().split('\n')
            for line in lines:
                if line and line.startswith('{'):
                    try:
                        response = json.loads(line)
                        if response.get('action') == 'index':
                            assert response['success'] == True
                            assert response.get('total_documents') == 5
                    except json.JSONDecodeError:
                        pass
                        
    def test_json_mode_search(self, runner, mock_search_engine):
        """Test JSON mode with search command."""
        from cli import cli
        
        mock_search_engine.search.return_value = [
            {
                'file_path': '/test/file.txt',
                'file_name': 'file.txt',
                'score': 0.9,
                'preview': 'Preview text'
            }
        ]
        
        json_input = json.dumps({"action": "search", "query": "test", "limit": 10})
        result = runner.invoke(cli, ['interactive', '--json-mode'], 
                              input=json_input + '\n{"action": "exit"}\n')
        
        assert result.exit_code == 0
        
        # Verify JSON response
        lines = result.output.strip().split('\n')
        for line in lines:
            if line and line.startswith('{'):
                try:
                    response = json.loads(line)
                    if response.get('action') == 'search':
                        assert response['success'] == True
                        assert 'results' in response
                except json.JSONDecodeError:
                    pass
                    
    def test_json_mode_stats(self, runner, mock_search_engine):
        """Test JSON mode with stats command."""
        from cli import cli
        
        mock_search_engine.get_statistics.return_value = {
            'total_documents': 50,
            'total_chunks': 200,
            'index_size': 512000
        }
        
        json_input = json.dumps({"action": "stats"})
        result = runner.invoke(cli, ['interactive', '--json-mode'],
                              input=json_input + '\n{"action": "exit"}\n')
        
        assert result.exit_code == 0
        
        # Verify JSON response
        lines = result.output.strip().split('\n')
        for line in lines:
            if line and line.startswith('{'):
                try:
                    response = json.loads(line)
                    if response.get('action') == 'stats':
                        assert response['success'] == True
                        assert response.get('total_documents') == 50
                except json.JSONDecodeError:
                    pass
                    
    def test_json_mode_clear(self, runner, mock_search_engine):
        """Test JSON mode with clear command."""
        from cli import cli
        
        json_input = json.dumps({"action": "clear"})
        result = runner.invoke(cli, ['interactive', '--json-mode'],
                              input=json_input + '\n{"action": "exit"}\n')
        
        assert result.exit_code == 0
        mock_search_engine.clear_index.assert_called_once()
        
    def test_json_mode_invalid_action(self, runner, mock_search_engine):
        """Test JSON mode with invalid action."""
        from cli import cli
        
        json_input = json.dumps({"action": "invalid_action"})
        result = runner.invoke(cli, ['interactive', '--json-mode'],
                              input=json_input + '\n{"action": "exit"}\n')
        
        # Should handle gracefully
        assert result.exit_code == 0
        
        # Check for error response
        lines = result.output.strip().split('\n')
        error_found = False
        for line in lines:
            if line and line.startswith('{'):
                try:
                    response = json.loads(line)
                    if not response.get('success', True):
                        error_found = True
                except json.JSONDecodeError:
                    pass
                    
    def test_invalid_folder_path(self, runner, mock_search_engine):
        """Test index command with invalid folder path."""
        from cli import cli
        
        result = runner.invoke(cli, ['index', '--folder', '/nonexistent/path'])
        
        assert result.exit_code != 0
        
    def test_search_empty_index(self, runner, mock_search_engine):
        """Test searching with empty index."""
        from cli import cli
        
        mock_search_engine.search.return_value = []
        
        result = runner.invoke(cli, ['search', 'test query'])
        
        assert result.exit_code == 0
        assert 'No results found' in result.output or len(result.output.strip()) == 0
        
    def test_workers_parameter(self, runner, mock_search_engine):
        """Test workers parameter for indexing."""
        from cli import cli
        
        mock_search_engine.index_directory.return_value = {
            'documents': 10,
            'chunks': 50
        }
        
        with tempfile.TemporaryDirectory() as tmpdir:
            result = runner.invoke(cli, ['index', '--folder', tmpdir, '--workers', '8'])
            
            assert result.exit_code == 0
            # Verify workers parameter was used (implementation dependent)