# Operations Guide

*Previous: [03-implementation.md](./03-implementation.md) | Next: [05-api-reference.md](./05-api-reference.md)*

---

## Application Startup Flow

### First-Time User (No Model)
1. **Application Launch**
   - Single instance lock ensures only one app instance
   - Main process creates BrowserWindow
   - Worker thread spawns and initializes database

2. **Model Check & Download**
   - Worker checks for model files in `~/Library/Application Support/Semantica/models/`
   - If missing, sequential download begins:
     - config.json (~0.6KB)
     - tokenizer_config.json (~0.4KB)
     - tokenizer.json (~16MB)
     - special_tokens_map.json (~0.2KB)
     - model_quantized.onnx (~113MB)
   - Progress shown in UI with per-file updates
   - Total download: ~115MB

3. **Initialization Complete**
   - Embedder child process spawns after model ready
   - File indexing begins automatically
   - Search UI becomes available

### Returning User (Model Exists)
1. **Fast Startup** (<1 second)
   - Model files verified (not re-downloaded)
   - Embedder spawns on first embedding request
   - Search UI available immediately
   - Background indexing resumes

## Troubleshooting Common Issues

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
2. Delete the database folder: `~/Library/Application Support/Semantica/data/`
3. Restart the app to recreate the database

### Performance Issues

#### High Memory Usage During Indexing
**Problem**: Processing many large files simultaneously.

**Current limits**:
- 5 files processed concurrently
- Embedder restarts after 500 files or 900MB RSS
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
- **Crash dumps**: `~/Library/Application Support/Semantica/Crashpad/`
- **File status**: Use file search to check individual file status

### Useful Debug Commands
```bash
# Check database size
du -sh ~/Library/Application\ Support/Semantica/data/

# List all indexed tables
ls ~/Library/Application\ Support/Semantica/data/

# Monitor memory usage during indexing
# Run the app with: npm run dev
# Memory stats are logged every 2 seconds

# Test a specific file parser
node -e "const {parseDoc} = require('./dist/worker.cjs'); parseDoc('/path/to/file.doc').then(console.log)"
```

## Performance Monitoring

### Memory Monitoring
Monitor application memory usage during indexing:

```bash
# Real-time memory stats (shown in console when running dev mode)
npm run dev
# Memory stats logged every 2 seconds:
# Memory: RSS=273MB, Heap=17MB/31MB, External=5MB, Files: 150
```

### Indexing Performance Metrics
Track indexing progress and performance:

```javascript
// Via DevTools Console (when in dev mode)
await window.api.indexer.progress()
// Returns: { queued: 10, processing: 3, completed: 147, failed: 5 }

// Database statistics
await window.api.db.stats()
// Returns: { chunks: 2451, files: 152, size: '45MB' }
```

### Performance Tuning

#### Adjusting Concurrency
Modify concurrent file processing based on system resources:
- **Default**: 5 files concurrent
- **Low memory**: Reduce to 2-3 files
- **High performance**: Increase to 8-10 files

#### Memory Limits
Tune memory thresholds in `src/main/worker/config.ts`:
```typescript
RSS_LIMIT: 1500,        // Increase for more memory
EXTERNAL_LIMIT: 300,    // Increase for larger models
FILES_LIMIT: 500        // Decrease for more frequent restarts
```

## Maintenance Tasks

### Regular Maintenance

#### 1. Database Optimization
Optimize vector index for better search performance:
```bash
# Run during idle time to create optimized index
# This happens automatically but can be triggered manually
```

#### 2. Clean Failed Files
Review and address failed indexing attempts:
1. Use file search (🔍) to find failed files
2. Check error messages for patterns
3. Fix underlying issues (OCR, corruption, etc.)
4. Re-index affected folders

#### 3. Parser Version Upgrades
When parsers are updated:
- Files are automatically queued for re-indexing
- Monitor progress in status bar
- Review improvements in search results

### Backup and Recovery

#### Backing Up Index
```bash
# Backup entire index
cp -r ~/Library/Application\ Support/Semantica/data ~/backup/

# Backup just configuration
cp ~/Library/Application\ Support/Semantica/data/config.json ~/backup/
```

#### Restoring Index
```bash
# Restore from backup
rm -rf ~/Library/Application\ Support/Semantica/data
cp -r ~/backup/data ~/Library/Application\ Support/Semantica/
```

#### Complete Reset
If experiencing persistent issues:
```bash
# Delete all app data
rm -rf ~/Library/Application\ Support/Semantica/

# Restart app - will recreate everything
open /Applications/Semantica.app
```

## Deployment & Distribution

### Building for Production
```bash
# Clean build
npm run clean
npm run build

# Create DMG for distribution
npm run package

# Output: dist/Semantica-1.0.0.dmg
```

### Code Signing & Notarization
For distribution outside App Store:
```bash
# Sign the app (requires Developer ID)
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: Your Name" \
  dist/mac/Semantica.app

# Notarize with Apple
xcrun altool --notarize-app \
  --primary-bundle-id "com.yourcompany.findersemanicsearch" \
  --username "your@email.com" \
  --password "@keychain:AC_PASSWORD" \
  --file dist/Semantica-1.0.0.dmg
```

### Installation Instructions
For end users:
1. Download Semantica.dmg
2. Open DMG file
3. Drag app to Applications folder
4. Launch from Applications
5. Grant necessary permissions when prompted

## Security Considerations

### Permissions Required
- **File System Access**: Read access to indexed folders
- **Full Disk Access**: Optional, for system folders
- **Automation**: Not required
- **Network**: Not required (100% offline)

### Privacy Best Practices
- All processing happens locally
- No telemetry or analytics
- Index stored in user's Library folder
- No cloud connectivity

## Getting Help

### Diagnostic Information
When reporting issues, provide:
1. File status from search (🔍)
2. Error messages from console
3. Memory statistics
4. Sample files (if not sensitive)

### Support Resources
- **Documentation**: This specs/ folder
- **Issues**: GitHub Issues for bug reports
- **Logs**: ~/Library/Logs/Semantica/
- **Community**: GitHub Discussions

### Common Solutions Checklist
- [ ] Restart the app
- [ ] Check file permissions
- [ ] Verify file opens in native app
- [ ] Review parser version compatibility
- [ ] Check available disk space
- [ ] Monitor memory usage
- [ ] Clear and rebuild index if needed

---

*Next: [05-api-reference.md](./05-api-reference.md) - API Documentation*