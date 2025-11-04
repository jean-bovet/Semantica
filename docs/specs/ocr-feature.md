# OCR Feature Specification

## Overview

Semantica includes Optical Character Recognition (OCR) capabilities for processing scanned PDFs and images embedded in PDF documents. This feature uses macOS Vision framework to extract text from PDFs that contain little or no machine-readable text.

**Status:** ✅ Implemented (v1.0.2+)
**Platform:** macOS 12 (Monterey) or later
**Default:** Enabled

## Architecture

### High-Level Flow

```
PDF File → TypeScript Parser → Detection Logic → Python Sidecar → macOS Vision → Extracted Text
```

### Components

#### 1. PDF Parser (TypeScript)
**Location:** `src/main/parsers/pdf.ts`

```typescript
export async function parsePdf(
  filePath: string,
  options?: { enableOCR?: boolean; sidecarClient?: PythonSidecarClient }
): Promise<PDFPage[]>
```

**Responsibilities:**
- Try standard text extraction first (pdf-parse)
- Detect if OCR is needed
- Call Python sidecar if OCR required
- Return unified page structure

#### 2. Python Sidecar (FastAPI)
**Location:** `embedding_sidecar/embed_server.py`

**OCR Endpoints:**
- `POST /ocr/detect` - Detect if PDF needs OCR
- `POST /ocr/extract` - Extract text using Vision framework

**Dependencies:**
- `ocrmac==1.0.0` - macOS Vision bindings
- `pymupdf==1.24.14` - PDF rendering
- `pdf2image==1.17.0` - PDF to image conversion

#### 3. macOS Vision Framework
**Native API:** Vision.framework (macOS system library)

**Capabilities:**
- Text recognition (OCR)
- Multi-language support
- High accuracy with modern PDFs
- Automatic language detection

## Detection Algorithm

### When OCR is Used

OCR is automatically triggered when:

1. **Text Density Check:** Average characters per page < 50
   ```typescript
   const avgCharsPerPage = data.text.length / data.numpages;
   const needsOCR = avgCharsPerPage < 50;
   ```

2. **User Setting:** `enableOCR` is true (default)

3. **Sidecar Available:** Python sidecar is running and responsive

### Detection Flow

```
1. Extract text with pdf-parse
2. Calculate: avg_chars = total_chars / num_pages
3. If avg_chars < 50:
   - Log: "Low text content detected"
   - Check enableOCR setting
   - If enabled: Call /ocr/detect endpoint
   - If needs_ocr: Call /ocr/extract endpoint
4. Else: Use standard extraction
```

## Configuration

### Application Settings

**User-Facing Setting:**
- **Location:** Settings → File Types → "Enable OCR for scanned PDFs"
- **Default:** Enabled (✓)
- **Behavior:** Globally enables/disables OCR for all PDFs

**Config Storage:**
```typescript
// src/shared/config/configIO.ts
interface AppConfig {
  settings: {
    enableOCR: boolean;  // Default: true
    // ... other settings
  }
}
```

### Implementation

```typescript
// Worker reads setting and passes to parser
const enableOCR = configManager?.getSettings().enableOCR ?? false;
const sidecarClient = sidecarService?.getClient();

const pages = await parsePdf(filePath, {
  enableOCR,
  sidecarClient
});
```

## Performance Characteristics

### Speed

| Operation | Time | Notes |
|-----------|------|-------|
| Standard text extraction | ~100ms/page | pdf-parse only |
| OCR detection | ~50-100ms | Lightweight check |
| OCR extraction | ~200-300ms/page | Depends on PDF quality |
| **Total (OCR)** | **~250-400ms/page** | Per-page average |

### Memory

| Component | Memory Usage | Notes |
|-----------|--------------|-------|
| Standard PDF | ~20-50MB | Base pdf-parse |
| OCR processing | +100-150MB peak | Vision framework overhead |
| **Total (OCR)** | **~120-200MB peak** | Per document |

### Disk Space

- OCR dependencies: ~200MB additional
- No persistent cache (processed on-demand)

## Error Handling

### Graceful Degradation

OCR failures do NOT prevent indexing:

```typescript
try {
  if (needsOCR && enableOCR && sidecarClient) {
    const ocrResult = await sidecarClient.extractWithOCR(filePath);
    return ocrResult.pages;
  }
} catch (error) {
  logger.warn('OCR failed, using standard extraction:', error);
  // Fall back to standard extraction (may be empty)
}
```

### Common Errors

**1. Vision Framework Unavailable**
- **Cause:** macOS < 12, or Vision.framework not accessible
- **Behavior:** Log warning, fall back to standard extraction
- **User Impact:** Scanned PDFs may show as "no text content"

**2. File Too Large**
- **Cause:** Memory limits exceeded during OCR
- **Behavior:** Timeout or memory error
- **Mitigation:** File size limits TBD

**3. Corrupt PDF**
- **Cause:** Invalid PDF structure
- **Behavior:** Standard extraction fails, OCR may also fail
- **User Impact:** File marked as failed

## Integration with Parser Versioning

### Version History

- **v1**: Initial pdf-parse implementation
- **v2**: Async file reading to prevent blocking
- **v3**: OCR support for scanned PDFs ✅

### Automatic Re-indexing

When PDF parser version updates from v2 → v3:

1. Re-indexing system detects version mismatch
2. Files with `parser_version < 3` queued for re-indexing
3. Previously failed scanned PDFs get OCR processing
4. Text extracted and indexed with new capability

```typescript
// Automatic re-indexing on version upgrade
if (fileRecord.parser_version < 3 && currentVersion === 3) {
  logger.log('PDF parser upgraded to v3 (OCR support)');
  return true; // Re-index this file
}
```

## Testing

### Unit Tests

**Location:** `tests/unit/parser-version-tracking.spec.ts`

- Parser version constants (PDF=3)
- Version history validation
- Re-indexing logic for upgrades

### Integration Tests

**Manual Testing Required:**
- OCR endpoints require real macOS Vision framework
- Test fixtures: scanned PDFs vs text-based PDFs
- Performance benchmarks with various PDF sizes

**Test Cases:**
1. Text-based PDF → standard extraction
2. Scanned PDF → OCR triggered
3. Mixed PDF (text + images) → OCR on low-density pages
4. enableOCR=false → OCR disabled globally
5. Sidecar unavailable → graceful fallback

## Limitations

### Platform-Specific

- **macOS Only:** Vision framework is macOS-exclusive
- **macOS 12+:** Requires Monterey or later
- **No Windows/Linux:** Feature automatically disabled on other platforms

### Technical

- **Language Support:** Depends on macOS Vision capabilities (50+ languages)
- **Handwriting:** Limited support for handwritten text
- **Complex Layouts:** Tables, multi-column layouts may have ordering issues
- **Image Quality:** Low-resolution scans may produce poor results
- **File Size:** Very large PDFs may cause memory issues

### Performance

- **Batch Processing:** OCR is CPU-intensive, processes sequentially
- **First Run:** No caching, every OCR request is fresh processing
- **Network:** N/A (all local processing)

## Future Enhancements

### Potential Improvements

1. **Progress Reporting:** Real-time OCR progress for large documents
2. **Caching:** Store OCR results to avoid reprocessing
3. **Parallel Processing:** OCR multiple pages concurrently
4. **Quality Settings:** User-selectable accuracy vs speed tradeoff
5. **Fallback OCR:** Tesseract.js for non-macOS platforms

### Out of Scope

- Video OCR (motion text recognition)
- Real-time OCR (live camera feed)
- Image format support (JPEG, PNG, etc.) - PDFs only
- Cloud OCR services (Google Vision, AWS Textract, etc.)

## References

- **Implementation:** `src/main/parsers/pdf.ts`
- **Sidecar Endpoints:** `embedding_sidecar/embed_server.py`
- **Configuration:** `src/shared/config/configIO.ts`
- **Settings UI:** `src/renderer/components/settings/FileTypesSettings.tsx`
- **Python Dependencies:** `embedding_sidecar/requirements.txt`

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.2 | 2025-01-XX | Initial OCR implementation with macOS Vision |
| 1.0.3 | TBD | Parser version tracking and automatic re-indexing |
