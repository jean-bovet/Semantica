import os
import json
import hashlib
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from pathlib import Path
import chardet
import PyPDF2
from docx import Document as DocxDocument
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading


@dataclass
class DocumentChunk:
    content: str
    metadata: Dict[str, Any]
    chunk_id: str
    document_id: str
    

class DocumentProcessor:
    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 200, json_mode: bool = False, num_workers: int = 4, metadata_store=None):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.should_stop_callback = None  # Callback to check if we should stop
        # Text documents
        text_docs = {'.txt', '.md', '.markdown', '.rst', '.tex', '.rtf'}
        # Office documents  
        office_docs = {'.pdf', '.docx', '.doc', '.odt'}
        # Programming languages
        programming = {'.py', '.java', '.js', '.ts', '.jsx', '.tsx', '.cpp', '.cc', '.cxx', 
                      '.h', '.hpp', '.c', '.swift', '.rb', '.go', '.rs', '.kt', '.scala',
                      '.php', '.pl', '.pm', '.r', '.m', '.mm', '.cs', '.vb', '.fs', '.clj',
                      '.dart', '.lua', '.jl', '.hs', '.elm', '.ex', '.exs', '.erl', '.hrl'}
        # Web and markup
        web_files = {'.html', '.htm', '.css', '.scss', '.sass', '.less', '.xml', '.xhtml',
                    '.svg', '.vue', '.jsx', '.tsx'}
        # Data and config files
        data_config = {'.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', 
                      '.properties', '.env', '.gitignore', '.dockerignore', '.editorconfig'}
        # Shell scripts
        shell_scripts = {'.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd'}
        # SQL and database
        database = {'.sql', '.psql', '.mysql'}
        # Build and project files
        build_files = {'.gradle', '.cmake', '.make', '.rake', '.sbt'}
        
        # Combine all extensions
        self.supported_extensions = (text_docs | office_docs | programming | web_files | 
                                    data_config | shell_scripts | database | build_files)
        
        # Also support files without extensions that are commonly text
        self.text_filenames = {'Makefile', 'Dockerfile', 'Jenkinsfile', 'Gemfile', 
                              'Rakefile', 'Vagrantfile', 'Podfile', 'README', 'LICENSE',
                              'CHANGELOG', 'TODO', 'NOTES', 'AUTHORS', 'CONTRIBUTORS'}
        
        self.json_mode = json_mode
        self.num_workers = num_workers
        self._progress_lock = threading.Lock()
        self._processed_count = 0
        self.metadata_store = metadata_store
    
    def process_directory(self, directory_path: str) -> List[DocumentChunk]:
        directory = Path(directory_path)
        if not directory.exists():
            raise ValueError(f"Directory {directory_path} does not exist")
        
        files = list(directory.rglob("*"))
        
        # Filter out files in hidden directories (starting with '.')
        valid_files = []
        for f in files:
            # Check if any parent directory is hidden
            if any(part.startswith('.') for part in f.parts):
                continue
            # Check if file has supported extension (case-insensitive)
            if f.suffix.lower() in self.supported_extensions:
                valid_files.append(f)
            # Also check for known text files without extensions
            elif f.name in self.text_filenames:
                valid_files.append(f)
        
        if self.json_mode:
            print(json.dumps({"status": "documents_found", "count": len(valid_files)}), flush=True)
        else:
            print(f"Found {len(valid_files)} documents to process")
        
        # Reset progress counter
        self._processed_count = 0
        total_files = len(valid_files)
        
        # Process files with multi-threading
        all_chunks = []
        
        if self.json_mode:
            # Use ThreadPoolExecutor for concurrent processing
            with ThreadPoolExecutor(max_workers=self.num_workers) as executor:
                # Submit all files for processing
                future_to_file = {
                    executor.submit(self._process_file_with_progress, str(file_path), idx, total_files): file_path
                    for idx, file_path in enumerate(valid_files)
                }
                
                # Collect results as they complete
                for future in as_completed(future_to_file):
                    file_path = future_to_file[future]
                    try:
                        chunks = future.result()
                        if chunks:
                            all_chunks.extend(chunks)
                    except Exception as e:
                        # Error messages still go to stdout as status
                        print(json.dumps({"status": "processing_error", "file": str(file_path), "error": str(e)}), flush=True)
        else:
            # Use ThreadPoolExecutor with tqdm for non-JSON mode
            with ThreadPoolExecutor(max_workers=self.num_workers) as executor:
                futures = []
                for file_path in valid_files:
                    future = executor.submit(self.process_file, str(file_path))
                    futures.append((future, file_path))
                
                # Use tqdm to show progress
                for future, file_path in tqdm(futures, desc="Processing documents"):
                    try:
                        chunks = future.result()
                        if chunks:
                            all_chunks.extend(chunks)
                    except Exception as e:
                        print(f"Error processing {file_path}: {e}")
        
        return all_chunks
    
    def process_directory_incremental(self, directory_path: str) -> Tuple[List[DocumentChunk], Dict[str, List]]:
        """
        Process directory with incremental indexing support.
        Returns: (chunks, change_info)
        """
        if not self.metadata_store:
            # Fall back to regular processing if no metadata store
            chunks = self.process_directory(directory_path)
            return chunks, {'new': [], 'modified': [], 'deleted': [], 'unchanged': []}
        
        # Get changed files
        from metadata_store import ChangeSet
        change_set = self.metadata_store.get_changed_files(
            directory_path, 
            self.supported_extensions,
            self.text_filenames
        )
        
        # Report change statistics
        if self.json_mode:
            print(json.dumps({
                "status": "change_detection",
                "new": len(change_set.new_files),
                "modified": len(change_set.modified_files),
                "deleted": len(change_set.deleted_files),
                "unchanged": len(change_set.unchanged_files)
            }), flush=True)
        else:
            print(f"Changes detected: {len(change_set.new_files)} new, "
                  f"{len(change_set.modified_files)} modified, "
                  f"{len(change_set.deleted_files)} deleted, "
                  f"{len(change_set.unchanged_files)} unchanged")
        
        # Process only changed files that have supported extensions
        files_to_process = []
        for file_path in change_set.new_files + change_set.modified_files:
            # Double-check file type is supported
            if file_path.suffix.lower() in self.supported_extensions or file_path.name in self.text_filenames:
                files_to_process.append(file_path)
            else:
                if self.json_mode:
                    print(json.dumps({
                        "status": "skipping_unsupported", 
                        "file": str(file_path),
                        "extension": file_path.suffix.lower()
                    }), flush=True)
        
        if not files_to_process and not change_set.deleted_files:
            if self.json_mode:
                print(json.dumps({"status": "no_changes"}), flush=True)
            else:
                print("No changes detected, index is up to date")
            return [], {
                'new': [],
                'modified': [],
                'deleted': change_set.deleted_files,
                'unchanged': [str(f) for f in change_set.unchanged_files]
            }
        
        # Process new and modified files
        if self.json_mode:
            print(json.dumps({"status": "documents_found", "count": len(files_to_process)}), flush=True)
        else:
            print(f"Processing {len(files_to_process)} changed documents")
        
        # Reset progress counter
        self._processed_count = 0
        total_files = len(files_to_process)
        all_chunks = []
        
        if self.json_mode and files_to_process:
            # Use ThreadPoolExecutor for concurrent processing
            with ThreadPoolExecutor(max_workers=self.num_workers) as executor:
                # Submit all files for processing
                future_to_file = {
                    executor.submit(self._process_file_with_progress, str(file_path), idx, total_files): file_path
                    for idx, file_path in enumerate(files_to_process)
                }
                
                # Collect results as they complete
                for future in as_completed(future_to_file):
                    # Check if we should stop
                    if self.should_stop_callback and self.should_stop_callback():
                        # Cancel all remaining futures
                        for f in future_to_file:
                            f.cancel()
                        print(json.dumps({"status": "indexing_cancelled"}), flush=True)
                        break
                    
                    file_path = future_to_file[future]
                    try:
                        chunks = future.result()
                        if chunks:
                            all_chunks.extend(chunks)
                    except Exception as e:
                        print(json.dumps({"status": "processing_error", "file": str(file_path), "error": str(e)}), flush=True)
        elif files_to_process:
            # Use ThreadPoolExecutor with tqdm for non-JSON mode
            with ThreadPoolExecutor(max_workers=self.num_workers) as executor:
                futures = []
                for file_path in files_to_process:
                    future = executor.submit(self.process_file, str(file_path))
                    futures.append((future, file_path))
                
                # Use tqdm to show progress
                for future, file_path in tqdm(futures, desc="Processing changed documents"):
                    try:
                        chunks = future.result()
                        if chunks:
                            all_chunks.extend(chunks)
                    except Exception as e:
                        print(f"Error processing {file_path}: {e}")
        
        # Return chunks and change information
        change_info = {
            'new': [str(f) for f in change_set.new_files],
            'modified': [str(f) for f in change_set.modified_files],
            'deleted': change_set.deleted_files,
            'unchanged': [str(f) for f in change_set.unchanged_files]
        }
        
        return all_chunks, change_info
    
    def _process_file_with_progress(self, file_path: str, file_idx: int, total_files: int) -> List[DocumentChunk]:
        """Process a file and report progress in thread-safe manner"""
        try:
            # Process the file first
            chunks = self.process_file(file_path)
            
            # Report progress after successful processing
            with self._progress_lock:
                self._processed_count += 1
                current = self._processed_count
                print(json.dumps({
                    "status": "processing_file", 
                    "current": current,
                    "total": total_files,
                    "file": os.path.basename(file_path)
                }), flush=True)
            
            return chunks
        except Exception as e:
            # Report error in thread-safe manner
            with self._progress_lock:
                self._processed_count += 1
                print(json.dumps({
                    "status": "processing_error", 
                    "file": os.path.basename(file_path), 
                    "error": str(e)
                }), flush=True)
            raise
    
    def process_file(self, file_path: str) -> List[DocumentChunk]:
        file_path_obj = Path(file_path)
        
        if not file_path_obj.exists():
            raise ValueError(f"File {file_path} does not exist")
        
        extension = file_path_obj.suffix.lower()
        filename = file_path_obj.name
        
        # First check if file type is supported
        if extension not in self.supported_extensions and filename not in self.text_filenames:
            raise ValueError(f"Unsupported file type: {extension}")
        
        # Handle PDF files
        if extension == '.pdf':
            text = self._extract_pdf_text(file_path)
        # Handle Word documents
        elif extension in ['.docx', '.doc', '.odt']:
            text = self._extract_docx_text(file_path)
        # Handle all text-based files (including code, config, etc.)
        else:
            text = self._extract_text_file(file_path)
        
        if not text:
            return []
        
        document_id = self._generate_document_id(file_path)
        chunks = self._create_chunks(text, file_path, document_id)
        
        return chunks
    
    def _extract_pdf_text(self, file_path: str) -> str:
        text = ""
        try:
            with open(file_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                for page_num in range(len(pdf_reader.pages)):
                    page = pdf_reader.pages[page_num]
                    page_text = page.extract_text()
                    if page_text:
                        text += f"\n--- Page {page_num + 1} ---\n{page_text}"
        except Exception as e:
            if self.json_mode:
                print(json.dumps({"status": "pdf_read_error", "file": file_path, "error": str(e)}), flush=True)
            else:
                print(f"Error reading PDF {file_path}: {e}")
            return ""
        
        return text
    
    def _extract_text_file(self, file_path: str) -> str:
        # Try multiple encodings to be more robust
        encodings_to_try = []
        
        # First try to detect encoding
        try:
            with open(file_path, 'rb') as file:
                raw_data = file.read()
                detected = chardet.detect(raw_data)
                if detected['encoding']:
                    encodings_to_try.append(detected['encoding'])
        except:
            pass
        
        # Add common encodings as fallbacks
        encodings_to_try.extend(['utf-8', 'latin-1', 'cp1252', 'ascii'])
        
        for encoding in encodings_to_try:
            try:
                with open(file_path, 'r', encoding=encoding, errors='replace') as file:
                    return file.read()
            except:
                continue
        
        # If all encodings fail, return empty string
        return ""
    
    def _extract_docx_text(self, file_path: str) -> str:
        try:
            doc = DocxDocument(file_path)
            text = "\n".join([paragraph.text for paragraph in doc.paragraphs])
            return text
        except Exception as e:
            print(f"Error reading DOCX {file_path}: {e}")
            return ""
    
    def _create_chunks(self, text: str, file_path: str, document_id: str) -> List[DocumentChunk]:
        chunks = []
        words = text.split()
        
        if not words:
            return chunks
        
        for i in range(0, len(words), self.chunk_size - self.chunk_overlap):
            chunk_words = words[i:i + self.chunk_size]
            chunk_text = " ".join(chunk_words)
            
            if len(chunk_text.strip()) < 50:
                continue
            
            chunk_id = hashlib.md5(f"{document_id}_{i}".encode()).hexdigest()
            
            metadata = {
                "file_path": file_path,
                "file_name": os.path.basename(file_path),
                "chunk_index": len(chunks),
                "start_index": i,
                "end_index": min(i + self.chunk_size, len(words))
            }
            
            chunk = DocumentChunk(
                content=chunk_text,
                metadata=metadata,
                chunk_id=chunk_id,
                document_id=document_id
            )
            
            chunks.append(chunk)
        
        return chunks
    
    def _generate_document_id(self, file_path: str) -> str:
        file_stat = os.stat(file_path)
        unique_string = f"{file_path}_{file_stat.st_mtime}_{file_stat.st_size}"
        return hashlib.md5(unique_string.encode()).hexdigest()


if __name__ == "__main__":
    processor = DocumentProcessor()
    test_dir = "../data/documents"
    
    if os.path.exists(test_dir):
        chunks = processor.process_directory(test_dir)
        print(f"Processed {len(chunks)} chunks from documents")
        if chunks:
            print(f"First chunk preview: {chunks[0].content[:200]}...")
    else:
        print(f"Test directory {test_dir} does not exist")