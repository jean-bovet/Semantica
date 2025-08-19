import os
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import numpy as np
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text

from document_processor import DocumentProcessor, DocumentChunk
from embeddings import EmbeddingGenerator
from indexer import FAISSIndexer


class DocumentSearchEngine:
    def __init__(self, 
                 index_dir: str = "./data/index",
                 embedding_model_type: str = "sentence-transformer",
                 embedding_model_name: Optional[str] = None):
        
        self.console = Console()
        
        self.embedding_generator = EmbeddingGenerator(
            model_type=embedding_model_type,
            model_name=embedding_model_name
        )
        
        self.indexer = FAISSIndexer(
            index_dir=index_dir,
            embedding_dim=self.embedding_generator.embedding_dim
        )
        
        self.document_processor = DocumentProcessor()
    
    def index_directory(self, directory_path: str, batch_size: int = 32):
        self.console.print(f"[bold blue]Indexing directory:[/bold blue] {directory_path}")
        
        chunks = self.document_processor.process_directory(directory_path)
        
        if not chunks:
            self.console.print("[yellow]No documents found to index[/yellow]")
            return
        
        self.console.print(f"[green]Found {len(chunks)} chunks to index[/green]")
        
        chunk_texts = [chunk.content for chunk in chunks]
        embeddings = self.embedding_generator.generate_embeddings(
            chunk_texts, 
            batch_size=batch_size
        )
        
        self.indexer.add_documents(chunks, embeddings)
        
        self.indexer.save_index()
        
        stats = self.indexer.get_statistics()
        self._display_index_stats(stats)
    
    def search(self, query: str, k: int = 10, display_results: bool = True) -> List[Tuple[DocumentChunk, float]]:
        if not query.strip():
            self.console.print("[red]Empty query provided[/red]")
            return []
        
        query_embedding = self.embedding_generator.generate_query_embedding(query)
        
        results = self.indexer.search(query_embedding, k=k)
        
        if display_results:
            self._display_search_results(query, results)
        
        return results
    
    def _display_search_results(self, query: str, results: List[Tuple[DocumentChunk, float]]):
        if not results:
            self.console.print("[yellow]No results found[/yellow]")
            return
        
        self.console.print(Panel(f"[bold]Search Query:[/bold] {query}", 
                                title="Search Results", 
                                border_style="blue"))
        
        documents_seen = {}
        
        for chunk, score in results:
            file_name = chunk.metadata.get("file_name", "Unknown")
            
            if file_name not in documents_seen:
                documents_seen[file_name] = []
            
            documents_seen[file_name].append((chunk, score))
        
        for file_name, file_results in documents_seen.items():
            table = Table(title=f"📄 {file_name}", show_header=True, header_style="bold magenta")
            table.add_column("Score", style="cyan", width=10)
            table.add_column("Content", style="white", overflow="fold")
            table.add_column("Location", style="dim", width=15)
            
            for chunk, score in file_results[:3]:
                content_preview = chunk.content[:200] + "..." if len(chunk.content) > 200 else chunk.content
                content_preview = content_preview.replace("\n", " ")
                
                location = f"Chunk {chunk.metadata.get('chunk_index', 'N/A')}"
                
                table.add_row(
                    f"{score:.4f}",
                    content_preview,
                    location
                )
            
            self.console.print(table)
            self.console.print("")
    
    def _display_index_stats(self, stats: Dict[str, Any]):
        table = Table(title="Index Statistics", show_header=False)
        table.add_column("Metric", style="cyan")
        table.add_column("Value", style="white")
        
        for key, value in stats.items():
            formatted_key = key.replace("_", " ").title()
            table.add_row(formatted_key, str(value))
        
        self.console.print(table)
    
    def add_document(self, file_path: str):
        self.console.print(f"[bold blue]Adding document:[/bold blue] {file_path}")
        
        chunks = self.document_processor.process_file(file_path)
        
        if not chunks:
            self.console.print("[yellow]No content extracted from document[/yellow]")
            return
        
        chunk_texts = [chunk.content for chunk in chunks]
        embeddings = self.embedding_generator.generate_embeddings(chunk_texts)
        
        self.indexer.add_documents(chunks, embeddings)
        
        self.indexer.save_index()
        
        self.console.print(f"[green]Added {len(chunks)} chunks from {file_path}[/green]")
    
    def remove_document(self, document_id: str):
        self.indexer.remove_document(document_id)
        self.indexer.save_index()
    
    def clear_index(self):
        self.indexer.clear_index()
        self.console.print("[green]Index cleared successfully[/green]")
    
    def get_similar_documents(self, file_path: str, k: int = 5) -> List[Tuple[DocumentChunk, float]]:
        chunks = self.document_processor.process_file(file_path)
        
        if not chunks:
            self.console.print("[yellow]No content extracted from document[/yellow]")
            return []
        
        all_results = []
        
        for chunk in chunks[:3]:
            embedding = self.embedding_generator.generate_query_embedding(chunk.content)
            results = self.indexer.search(embedding, k=k)
            
            for result_chunk, score in results:
                if result_chunk.document_id != chunk.document_id:
                    all_results.append((result_chunk, score))
        
        seen_docs = set()
        unique_results = []
        for chunk, score in sorted(all_results, key=lambda x: x[1], reverse=True):
            if chunk.document_id not in seen_docs:
                seen_docs.add(chunk.document_id)
                unique_results.append((chunk, score))
                if len(unique_results) >= k:
                    break
        
        return unique_results


if __name__ == "__main__":
    search_engine = DocumentSearchEngine()
    
    test_dir = "../data/documents"
    if os.path.exists(test_dir):
        sample_files = os.listdir(test_dir)
        if sample_files:
            print(f"Test directory contains: {sample_files}")
    
    stats = search_engine.indexer.get_statistics()
    print(f"Current index has {stats['total_chunks']} chunks")
    
    if stats['total_chunks'] > 0:
        test_query = "machine learning"
        print(f"\nSearching for: '{test_query}'")
        results = search_engine.search(test_query, k=5)
        print(f"Found {len(results)} results")