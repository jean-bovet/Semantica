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
    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 200, json_mode: bool = False, num_workers: int = 4):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.supported_extensions = {'.pdf', '.txt', '.docx', '.doc', '.md'}
        self.json_mode = json_mode
        self.num_workers = num_workers
        self._progress_lock = threading.Lock()
        self._processed_count = 0
    
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
            # Check if file has supported extension
            if f.suffix.lower() in self.supported_extensions:
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
        
        if extension == '.pdf':
            text = self._extract_pdf_text(file_path)
        elif extension in ['.txt', '.md']:
            text = self._extract_text_file(file_path)
        elif extension in ['.docx', '.doc']:
            text = self._extract_docx_text(file_path)
        else:
            raise ValueError(f"Unsupported file type: {extension}")
        
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