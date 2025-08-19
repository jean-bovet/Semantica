import os
import hashlib
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from pathlib import Path
import chardet
import PyPDF2
from docx import Document as DocxDocument
from tqdm import tqdm


@dataclass
class DocumentChunk:
    content: str
    metadata: Dict[str, Any]
    chunk_id: str
    document_id: str
    

class DocumentProcessor:
    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 200):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.supported_extensions = {'.pdf', '.txt', '.docx', '.doc', '.md'}
    
    def process_directory(self, directory_path: str) -> List[DocumentChunk]:
        directory = Path(directory_path)
        if not directory.exists():
            raise ValueError(f"Directory {directory_path} does not exist")
        
        all_chunks = []
        files = list(directory.rglob("*"))
        valid_files = [f for f in files if f.suffix.lower() in self.supported_extensions]
        
        print(f"Found {len(valid_files)} documents to process")
        
        for file_path in tqdm(valid_files, desc="Processing documents"):
            try:
                chunks = self.process_file(str(file_path))
                all_chunks.extend(chunks)
            except Exception as e:
                print(f"Error processing {file_path}: {e}")
                continue
        
        return all_chunks
    
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
            print(f"Error reading PDF {file_path}: {e}")
            return ""
        
        return text
    
    def _extract_text_file(self, file_path: str) -> str:
        try:
            with open(file_path, 'rb') as file:
                raw_data = file.read()
                detected = chardet.detect(raw_data)
                encoding = detected['encoding'] or 'utf-8'
            
            with open(file_path, 'r', encoding=encoding) as file:
                return file.read()
        except Exception as e:
            print(f"Error reading text file {file_path}: {e}")
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