#!/usr/bin/env python3

import os
import sys
import json
import click
import yaml
from pathlib import Path
from rich.console import Console
from rich.prompt import Prompt, Confirm
from rich.panel import Panel

sys.path.append(str(Path(__file__).parent / "src"))

from search import DocumentSearchEngine


console = Console()


def get_search_engine(ctx, json_mode=False):
    """Get or create the search engine with appropriate settings"""
    if ctx.obj.get('search_engine') is None or \
       (json_mode and not getattr(ctx.obj.get('search_engine'), 'json_mode', False)):
        config = ctx.obj['config']
        ctx.obj['search_engine'] = DocumentSearchEngine(
            index_dir=config['index_dir'],
            embedding_model_type=config['embedding_model_type'],
            embedding_model_name=config.get('embedding_model_name'),
            json_mode=json_mode,
            num_workers=config.get('num_workers', 4)
        )
    return ctx.obj['search_engine']


def load_config():
    config_path = Path("config.yaml")
    if config_path.exists():
        with open(config_path, 'r') as f:
            return yaml.safe_load(f)
    return {
        "index_dir": "./data/index",
        "embedding_model_type": "sentence-transformer",
        "embedding_model_name": "all-MiniLM-L6-v2",
        "default_search_results": 10
    }


@click.group()
@click.pass_context
def cli(ctx):
    """Local Document Search Engine - Index and search your documents using AI"""
    ctx.ensure_object(dict)
    config = load_config()
    ctx.obj['config'] = config
    # Don't create search engine here - let commands create it as needed
    ctx.obj['search_engine'] = None


@cli.command()
@click.option('--folder', '-f', required=True, type=click.Path(exists=True), 
              help='Path to folder containing documents')
@click.option('--batch-size', '-b', default=64, help='Batch size for embedding generation')
@click.option('--workers', '-w', default=4, help='Number of parallel workers for file processing')
@click.option('--json', 'json_output', is_flag=True, help='Output in JSON format')
@click.pass_context
def index(ctx, folder, batch_size, workers, json_output):
    """Index all documents in a folder"""
    # Temporarily set num_workers in config for this command
    ctx.obj['config']['num_workers'] = workers
    search_engine = get_search_engine(ctx, json_mode=json_output)
    
    if json_output:
        try:
            search_engine.index_directory(folder, batch_size=batch_size)
            stats = search_engine.indexer.get_statistics()
            result = {
                'success': True,
                'folder': folder,
                'total_documents': stats.get('total_documents', 0),
                'total_chunks': stats.get('total_chunks', 0)
            }
            print(json.dumps(result))
        except Exception as e:
            result = {'success': False, 'error': str(e)}
            print(json.dumps(result))
            sys.exit(1)
    else:
        console.print(Panel.fit(
            f"[bold cyan]Indexing documents in:[/bold cyan] {folder}",
            title="Document Indexing",
            border_style="cyan"
        ))
        
        try:
            search_engine.index_directory(folder, batch_size=batch_size)
            console.print("[bold green]✓ Indexing completed successfully![/bold green]")
        except Exception as e:
            console.print(f"[bold red]✗ Error during indexing:[/bold red] {e}")
            sys.exit(1)


@cli.command()
@click.argument('query', nargs=-1, required=True)
@click.option('--results', '-k', default=10, help='Number of results to return')
@click.option('--json', 'json_output', is_flag=True, help='Output in JSON format')
@click.pass_context
def search(ctx, query, results, json_output):
    """Search for documents matching your query"""
    search_engine = get_search_engine(ctx, json_mode=json_output)
    query_text = ' '.join(query)
    
    if json_output:
        try:
            # We need to get raw results, not display them
            search_results = search_engine.search(query_text, k=results, display_results=False)
            
            # Format results for JSON output
            formatted_results = []
            for chunk, score in search_results:
                formatted_results.append({
                    'file_path': chunk.metadata.get('file_path', ''),
                    'file_name': chunk.metadata.get('file_name', 'Unknown'),
                    'score': float(score),
                    'preview': chunk.content[:200],  # First 200 chars as preview
                    'page_number': chunk.metadata.get('page_number')
                })
            
            output = {
                'success': True,
                'query': query_text,
                'results': formatted_results
            }
            print(json.dumps(output))
        except Exception as e:
            output = {'success': False, 'error': str(e)}
            print(json.dumps(output))
            sys.exit(1)
    else:
        console.print(Panel.fit(
            f"[bold cyan]Searching for:[/bold cyan] {query_text}",
            title="Document Search",
            border_style="cyan"
        ))
        
        try:
            search_results = search_engine.search(query_text, k=results)
            
            if not search_results:
                console.print("[yellow]No matching documents found. Try different keywords.[/yellow]")
        except Exception as e:
            console.print(f"[bold red]✗ Error during search:[/bold red] {e}")
            sys.exit(1)


@cli.command()
@click.option('--json-mode', is_flag=True, help='Interactive JSON I/O mode for GUI integration')
@click.pass_context
def interactive(ctx, json_mode):
    """Start an interactive search session"""
    search_engine = get_search_engine(ctx, json_mode=json_mode)
    
    if json_mode:
        # JSON mode for GUI integration
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                    
                command = json.loads(line.strip())
                action = command.get('action')
                
                if action == 'search':
                    query = command.get('query', '')
                    limit = command.get('limit', 10)
                    
                    try:
                        results = search_engine.search(query, k=limit, display_results=False)
                        formatted_results = []
                        for chunk, score in results:
                            formatted_results.append({
                                'file_path': chunk.metadata.get('file_path', ''),
                                'file_name': chunk.metadata.get('file_name', 'Unknown'),
                                'score': float(score),
                                'preview': chunk.content[:200],
                                'page_number': chunk.metadata.get('page_number')
                            })
                        
                        response = {
                            'success': True,
                            'action': 'search',
                            'results': formatted_results
                        }
                    except Exception as e:
                        response = {
                            'success': False,
                            'action': 'search',
                            'error': str(e)
                        }
                
                elif action == 'index':
                    folder = command.get('folder')
                    incremental = command.get('incremental', True)  # Default to incremental
                    if folder:
                        try:
                            if incremental:
                                search_engine.index_directory_incremental(folder)
                            else:
                                search_engine.index_directory(folder)
                            stats = search_engine.indexer.get_statistics()
                            response = {
                                'success': True,
                                'action': 'index',
                                'total_documents': stats.get('total_documents', 0),
                                'total_chunks': stats.get('total_chunks', 0)
                            }
                        except Exception as e:
                            response = {
                                'success': False,
                                'action': 'index',
                                'error': str(e)
                            }
                    else:
                        response = {
                            'success': False,
                            'action': 'index',
                            'error': 'No folder specified'
                        }
                
                elif action == 'stats':
                    try:
                        stats = search_engine.indexer.get_statistics()
                        response = {
                            'success': True,
                            'action': 'stats',
                            'stats': stats
                        }
                    except Exception as e:
                        response = {
                            'success': False,
                            'action': 'stats',
                            'error': str(e)
                        }
                
                elif action == 'clear':
                    try:
                        search_engine.indexer.clear_index()
                        response = {
                            'success': True,
                            'action': 'clear',
                            'message': 'Index cleared'
                        }
                    except Exception as e:
                        response = {
                            'success': False,
                            'action': 'clear',
                            'error': str(e)
                        }
                
                elif action == 'exit':
                    response = {
                        'success': True,
                        'action': 'exit',
                        'message': 'Goodbye'
                    }
                    print(json.dumps(response))
                    sys.stdout.flush()
                    break
                
                else:
                    response = {
                        'success': False,
                        'error': f'Unknown action: {action}'
                    }
                
                print(json.dumps(response))
                sys.stdout.flush()  # Important for real-time communication
                
            except json.JSONDecodeError as e:
                response = {
                    'success': False,
                    'error': f'Invalid JSON: {str(e)}'
                }
                print(json.dumps(response))
                sys.stdout.flush()
            except Exception as e:
                response = {
                    'success': False,
                    'error': str(e)
                }
                print(json.dumps(response))
                sys.stdout.flush()
    else:
        # Original interactive mode for human users
        console.print(Panel.fit(
            "[bold cyan]Interactive Search Mode[/bold cyan]\n"
            "Type 'quit' or 'exit' to end the session\n"
            "Type 'stats' to see index statistics\n"
            "Type 'clear' to clear the screen",
            title="Interactive Mode",
            border_style="cyan"
        ))
        
        while True:
            try:
                query = Prompt.ask("\n[bold blue]Search[/bold blue]")
                
                if query.lower() in ['quit', 'exit', 'q']:
                    console.print("[yellow]Goodbye![/yellow]")
                    break
                elif query.lower() == 'stats':
                    stats = search_engine.indexer.get_statistics()
                    search_engine._display_index_stats(stats)
                elif query.lower() == 'clear':
                    console.clear()
                elif query.strip():
                    search_engine.search(query, k=10)
                
            except KeyboardInterrupt:
                console.print("\n[yellow]Interrupted. Goodbye![/yellow]")
                break
            except Exception as e:
                console.print(f"[red]Error: {e}[/red]")


@cli.command()
@click.option('--file', '-f', required=True, type=click.Path(exists=True),
              help='Path to document to add')
@click.pass_context
def add(ctx, file):
    """Add a single document to the index"""
    search_engine = get_search_engine(ctx)
    
    console.print(f"[cyan]Adding document: {file}[/cyan]")
    
    try:
        search_engine.add_document(file)
        console.print("[green]✓ Document added successfully![/green]")
    except Exception as e:
        console.print(f"[red]✗ Error adding document: {e}[/red]")
        sys.exit(1)


@cli.command()
@click.option('--folder', '-f', required=True, type=click.Path(exists=True),
              help='Path to folder with new documents')
@click.pass_context
def update(ctx, folder):
    """Update index with new documents from a folder"""
    search_engine = get_search_engine(ctx)
    
    console.print(f"[cyan]Updating index with documents from: {folder}[/cyan]")
    
    try:
        search_engine.index_directory(folder)
        console.print("[green]✓ Index updated successfully![/green]")
    except Exception as e:
        console.print(f"[red]✗ Error updating index: {e}[/red]")
        sys.exit(1)


@cli.command()
@click.pass_context
def clear(ctx):
    """Clear the entire index"""
    search_engine = get_search_engine(ctx)
    
    if Confirm.ask("[bold yellow]Are you sure you want to clear the entire index?[/bold yellow]"):
        try:
            search_engine.clear_index()
            console.print("[green]✓ Index cleared successfully![/green]")
        except Exception as e:
            console.print(f"[red]✗ Error clearing index: {e}[/red]")
            sys.exit(1)
    else:
        console.print("[yellow]Clear operation cancelled[/yellow]")


@cli.command()
@click.pass_context
def stats(ctx):
    """Display index statistics"""
    search_engine = get_search_engine(ctx)
    
    try:
        stats = search_engine.indexer.get_statistics()
        console.print(Panel.fit(
            "[bold cyan]Index Statistics[/bold cyan]",
            border_style="cyan"
        ))
        search_engine._display_index_stats(stats)
    except Exception as e:
        console.print(f"[red]✗ Error getting statistics: {e}[/red]")
        sys.exit(1)


@cli.command()
@click.option('--file', '-f', required=True, type=click.Path(exists=True),
              help='Path to document to find similar documents for')
@click.option('--results', '-k', default=5, help='Number of similar documents to find')
@click.pass_context
def similar(ctx, file, results):
    """Find documents similar to a given document"""
    search_engine = get_search_engine(ctx)
    
    console.print(f"[cyan]Finding documents similar to: {file}[/cyan]")
    
    try:
        similar_docs = search_engine.get_similar_documents(file, k=results)
        
        if similar_docs:
            console.print(Panel.fit(
                f"[bold]Documents similar to:[/bold] {Path(file).name}",
                title="Similar Documents",
                border_style="blue"
            ))
            
            for chunk, score in similar_docs:
                file_name = chunk.metadata.get("file_name", "Unknown")
                console.print(f"  [cyan]{score:.4f}[/cyan] - [white]{file_name}[/white]")
                console.print(f"    [dim]{chunk.content[:100]}...[/dim]")
        else:
            console.print("[yellow]No similar documents found[/yellow]")
    
    except Exception as e:
        console.print(f"[red]✗ Error finding similar documents: {e}[/red]")
        sys.exit(1)


@cli.command()
def setup():
    """Interactive setup wizard for first-time configuration"""
    console.print(Panel.fit(
        "[bold cyan]Local Document Search Setup Wizard[/bold cyan]",
        border_style="cyan"
    ))
    
    config = {}
    
    config['index_dir'] = Prompt.ask(
        "Index directory path",
        default="./data/index"
    )
    
    model_type = Prompt.ask(
        "Embedding model type",
        choices=["sentence-transformer", "ollama"],
        default="sentence-transformer"
    )
    config['embedding_model_type'] = model_type
    
    if model_type == "sentence-transformer":
        config['embedding_model_name'] = Prompt.ask(
            "Model name",
            default="all-MiniLM-L6-v2"
        )
    else:
        config['embedding_model_name'] = Prompt.ask(
            "Ollama model name",
            default="nomic-embed-text"
        )
    
    config['default_search_results'] = int(Prompt.ask(
        "Default number of search results",
        default="10"
    ))
    
    config_path = Path("config.yaml")
    with open(config_path, 'w') as f:
        yaml.dump(config, f, default_flow_style=False)
    
    console.print("[green]✓ Configuration saved to config.yaml[/green]")
    
    if model_type == "ollama":
        console.print("\n[yellow]Note: Make sure Ollama is running:[/yellow]")
        console.print("  ollama serve")
        console.print(f"  ollama pull {config['embedding_model_name']}")


if __name__ == '__main__':
    cli(obj={})