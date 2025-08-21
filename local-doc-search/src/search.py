import os
import json
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
from metadata_store import MetadataStore


class DocumentSearchEngine:
    def __init__(self, 
                 index_dir: str = "./data/index",
                 embedding_model_type: str = "sentence-transformer",
                 embedding_model_name: Optional[str] = None,
                 json_mode: bool = False,
                 num_workers: int = 4,
                 enable_incremental: bool = True):
        
        self.json_mode = json_mode
        self.console = Console()
        self.should_stop_callback = None  # Callback to check if we should stop
        self.index_dir = index_dir
        
        self.embedding_generator = EmbeddingGenerator(
            model_type=embedding_model_type,
            model_name=embedding_model_name,
            json_mode=json_mode
        )
        
        self.indexer = FAISSIndexer(
            index_dir=index_dir,
            embedding_dim=self.embedding_generator.embedding_dim,
            json_mode=json_mode
        )
        
        # Initialize metadata store for incremental indexing
        self.metadata_store = None
        if enable_incremental:
            metadata_path = os.path.join(index_dir, "metadata.db")
            self.metadata_store = MetadataStore(metadata_path)
        
        self.document_processor = DocumentProcessor(
            json_mode=json_mode,
            num_workers=num_workers,
            metadata_store=self.metadata_store
        )
    
    def index_directory(self, directory_path: str, batch_size: int = 64):
        if self.json_mode:
            print(json.dumps({"status": "indexing_directory", "path": directory_path}), flush=True)
        else:
            self.console.print(f"[bold blue]Indexing directory:[/bold blue] {directory_path}")
        
        chunks = self.document_processor.process_directory(directory_path)
        
        if not chunks:
            if self.json_mode:
                print(json.dumps({"status": "no_documents_found"}), flush=True)
            else:
                self.console.print("[yellow]No documents found to index[/yellow]")
            return
        
        if self.json_mode:
            print(json.dumps({"status": "chunks_found", "count": len(chunks)}), flush=True)
        else:
            self.console.print(f"[green]Found {len(chunks)} chunks to index[/green]")
        
        chunk_texts = [chunk.content for chunk in chunks]
        embeddings = self.embedding_generator.generate_embeddings(
            chunk_texts, 
            batch_size=batch_size
        )
        
        self.indexer.add_documents(chunks, embeddings)
        
        self.indexer.save_index()
        
        if not self.json_mode:
            stats = self.indexer.get_statistics()
            self._display_index_stats(stats)
    
    def index_directory_incremental(self, directory_path: str, batch_size: int = 64):
        """Index directory with incremental updates - only process changed files"""
        if not self.metadata_store:
            # Fall back to regular indexing
            return self.index_directory(directory_path, batch_size)
        
        if self.json_mode:
            print(json.dumps({"status": "checking_changes", "path": directory_path}), flush=True)
        else:
            self.console.print(f"[bold blue]Checking for changes in:[/bold blue] {directory_path}")
        
        # Pass the stop callback to document processor
        if self.should_stop_callback:
            self.document_processor.should_stop_callback = self.should_stop_callback
        
        # Get changed files and process them
        chunks, change_info = self.document_processor.process_directory_incremental(directory_path)
        
        # Handle deleted files
        for deleted_file in change_info['deleted']:
            doc_id = self.metadata_store.remove_file(deleted_file)
            if doc_id:
                # TODO: Remove from FAISS index when supported
                if self.json_mode:
                    print(json.dumps({"status": "removed_file", "file": deleted_file}), flush=True)
        
        if not chunks and not change_info['deleted']:
            if self.json_mode:
                print(json.dumps({"status": "no_changes", "unchanged": len(change_info['unchanged'])}), flush=True)
            else:
                self.console.print(f"[green]No changes detected. {len(change_info['unchanged'])} files unchanged.[/green]")
            return
        
        if chunks:
            if self.json_mode:
                print(json.dumps({"status": "chunks_found", "count": len(chunks)}), flush=True)
            else:
                self.console.print(f"[green]Processing {len(chunks)} chunks from changed files[/green]")
            
            # Generate embeddings for new/modified chunks
            chunk_texts = [chunk.content for chunk in chunks]
            embeddings = self.embedding_generator.generate_embeddings(
                chunk_texts, 
                batch_size=batch_size
            )
            
            # Add to index and track in metadata
            start_idx = self.indexer.get_index_size()
            self.indexer.add_documents(chunks, embeddings)
            
            # Update metadata for each file
            file_chunks = {}
            for i, chunk in enumerate(chunks):
                file_path = chunk.metadata.get('file_path')
                if file_path not in file_chunks:
                    file_chunks[file_path] = {
                        'document_id': chunk.document_id,
                        'chunk_ids': [],
                        'vector_indices': []
                    }
                file_chunks[file_path]['chunk_ids'].append(chunk.chunk_id)
                file_chunks[file_path]['vector_indices'].append(start_idx + i)
            
            # Save metadata for each file
            for file_path, info in file_chunks.items():
                self.metadata_store.update_file(
                    file_path,
                    info['document_id'],
                    info['chunk_ids'],
                    info['vector_indices']
                )
        
        # Save index
        self.indexer.save_index()
        
        # Update folder stats
        self.metadata_store.update_folder_stats(
            directory_path,
            len(change_info['new']) + len(change_info['modified']) + len(change_info['unchanged'])
        )
        
        if self.json_mode:
            stats = self.indexer.get_statistics()
            print(json.dumps({
                "status": "incremental_complete",
                "new_files": len(change_info['new']),
                "modified_files": len(change_info['modified']),
                "deleted_files": len(change_info['deleted']),
                "unchanged_files": len(change_info['unchanged']),
                "total_chunks": stats.get('total_chunks', 0)
            }), flush=True)
        else:
            self.console.print(Panel(
                f"[green]Incremental indexing complete![/green]\n"
                f"New: {len(change_info['new'])}, Modified: {len(change_info['modified'])}, "
                f"Deleted: {len(change_info['deleted'])}, Unchanged: {len(change_info['unchanged'])}",
                title="Indexing Results",
                border_style="green"
            ))
    
    def search(self, query: str, k: int = 10, display_results: bool = True) -> List[Tuple[DocumentChunk, float]]:
        if not query.strip():
            if self.json_mode:
                print(json.dumps({"status": "empty_query"}), flush=True)
            else:
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
        if self.json_mode:
            print(json.dumps({"status": "adding_document", "path": file_path}), flush=True)
        else:
            self.console.print(f"[bold blue]Adding document:[/bold blue] {file_path}")
        
        chunks = self.document_processor.process_file(file_path)
        
        if not chunks:
            if self.json_mode:
                print(json.dumps({"status": "no_content_extracted"}), flush=True)
            else:
                self.console.print("[yellow]No content extracted from document[/yellow]")
            return
        
        chunk_texts = [chunk.content for chunk in chunks]
        embeddings = self.embedding_generator.generate_embeddings(chunk_texts)
        
        self.indexer.add_documents(chunks, embeddings)
        
        self.indexer.save_index()
        
        if self.json_mode:
            print(json.dumps({"status": "document_added", "chunks": len(chunks), "path": file_path}), flush=True)
        else:
            self.console.print(f"[green]Added {len(chunks)} chunks from {file_path}[/green]")
    
    def remove_document(self, document_id: str):
        self.indexer.remove_document(document_id)
        self.indexer.save_index()
    
    def clear_index(self):
        self.indexer.clear_index()
        # Also clear metadata if incremental indexing is enabled
        if self.metadata_store:
            self.metadata_store.clear_all()
        if not self.json_mode:
            self.console.print("[green]Index and metadata cleared successfully[/green]")
    
    def get_similar_documents(self, file_path: str, k: int = 5) -> List[Tuple[DocumentChunk, float]]:
        chunks = self.document_processor.process_file(file_path)
        
        if not chunks:
            if self.json_mode:
                print(json.dumps({"status": "no_content_extracted"}), flush=True)
            else:
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