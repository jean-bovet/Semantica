# Troubleshooting Guide

## Common Issues and Solutions

### Files Not Being Indexed

#### 1. Scanned PDFs Show "No text extracted"
**Problem**: PDFs created by scanners contain only images, not searchable text.

**Identification**: 
- File search shows ⚠ warning with "PDF contains no extractable text"
- PDFs created by scanner software (PaperStream, Canon, Epson, etc.)
- Large file sizes but no searchable content

**Solutions**:
- **Immediate**: Use macOS Preview or Adobe Acrobat to run OCR on the PDFs first
- **Batch processing**: Use tools like `ocrmypdf` to process multiple files:
  ```bash
  # Install ocrmypdf
  brew install ocrmypdf
  
  # Process a single file
  ocrmypdf input.pdf output.pdf
  
  # Process all PDFs in a folder
  find /path/to/folder -name "*.pdf" -exec ocrmypdf {} {}_ocr.pdf \;
  ```

#### 2. Old Word Documents (.doc) Not Indexing
**Problem**: Legacy .doc files from Word 97-2003 may fail to parse.

**Solution**: 
- The app now uses `word-extractor` library which handles most .doc files
- If still failing, convert to .docx format using Microsoft Word or LibreOffice

#### 3. Files Show as "Failed" or "Error" Status
**Problem**: Various parsing errors can occur.

**How to check**:
1. Click the 🔍 icon in the status bar
2. Search for the filename
3. Check the status and error message

**Common causes and solutions**:
- **"Not a valid PDF"**: File may be corrupted. Try opening in a PDF reader to verify.
- **"No text content extracted"**: File may be empty or contain only formatting.
- **Permission errors**: Check file permissions in Finder.

### Database Issues

#### "Worker not ready" Errors on Startup
**Problem**: Normal during app initialization.

**Solution**: Wait 2-3 seconds for the worker to initialize. Errors should stop.

#### "Table 'file_status' was not found"
**Problem**: Database initialization issue.

**Solution**: 
1. Close the app
2. Delete the database folder: `~/Library/Application Support/offline-mac-search/data/`
3. Restart the app to recreate the database

### Performance Issues

#### High Memory Usage During Indexing
**Problem**: Processing many large files simultaneously.

**Current limits**:
- 5 files processed concurrently
- Embedder restarts after 200 files or 900MB RSS
- Automatic throttling when RSS > 800MB

**Solutions**:
- Pause indexing when doing other work
- Index folders incrementally rather than all at once
- Exclude folders with many scanned PDFs temporarily

#### Indexing is Very Slow
**Possible causes**:
1. Many scanned PDFs that fail to parse
2. Very large documents (>10MB)
3. Network drives or slow external storage

**Solutions**:
- Check file search for failed files and address them
- Consider splitting very large documents
- Copy files to local drive before indexing

### Search Issues

#### Semantic Search Not Finding Known Content
**Possible causes**:
1. File failed to index (check file search)
2. Content is in a scanned PDF
3. File type not enabled in settings

**How to verify**:
1. Use file search (🔍) to check file status
2. Look for ✓ (indexed) vs ⚠ (failed) vs ✗ (error)
3. Check Settings for enabled file types

#### File Search Shows Wrong Status
**Problem**: Status may be cached or outdated.

**Solution**:
- Status updates during indexing
- Restart app to refresh all statuses
- Check the actual chunk count - 0 chunks means not indexed

## Logs and Debugging

### Where to Find Logs
- **Console output**: Run with `npm run dev` to see all logs
- **Crash dumps**: `~/Library/Application Support/offline-mac-search/Crashpad/`
- **File status**: Use file search to check individual file status

### Useful Debug Commands
```bash
# Check database size
du -sh ~/Library/Application\ Support/offline-mac-search/data/

# List all indexed tables
ls ~/Library/Application\ Support/offline-mac-search/data/

# Monitor memory usage during indexing
# Run the app with: npm run dev
# Memory stats are logged every 2 seconds

# Test a specific file parser
node -e "const {parseDoc} = require('./dist/worker.cjs'); parseDoc('/path/to/file.doc').then(console.log)"
```

## Getting Help

If issues persist:
1. Check file status using the file search (🔍)
2. Note any error messages
3. Check if the file opens correctly in its native application
4. Report issues with example files (if not sensitive) at the project repository