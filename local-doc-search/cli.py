#!/usr/bin/env python3

import os
import sys
import click
import yaml
from pathlib import Path
from rich.console import Console
from rich.prompt import Prompt, Confirm
from rich.panel import Panel

sys.path.append(str(Path(__file__).parent / "src"))

from search import DocumentSearchEngine


console = Console()


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
    ctx.obj['search_engine'] = DocumentSearchEngine(
        index_dir=config['index_dir'],
        embedding_model_type=config['embedding_model_type'],
        embedding_model_name=config.get('embedding_model_name')
    )


@cli.command()
@click.option('--folder', '-f', required=True, type=click.Path(exists=True), 
              help='Path to folder containing documents')
@click.option('--batch-size', '-b', default=32, help='Batch size for embedding generation')
@click.pass_context
def index(ctx, folder, batch_size):
    """Index all documents in a folder"""
    search_engine = ctx.obj['search_engine']
    
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
@click.pass_context
def search(ctx, query, results):
    """Search for documents matching your query"""
    search_engine = ctx.obj['search_engine']
    query_text = ' '.join(query)
    
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
@click.pass_context
def interactive(ctx):
    """Start an interactive search session"""
    search_engine = ctx.obj['search_engine']
    
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
    search_engine = ctx.obj['search_engine']
    
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
    search_engine = ctx.obj['search_engine']
    
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
    search_engine = ctx.obj['search_engine']
    
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
    search_engine = ctx.obj['search_engine']
    
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
    search_engine = ctx.obj['search_engine']
    
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