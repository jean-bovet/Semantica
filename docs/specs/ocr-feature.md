# OCR Feature Specification

## Overview

Semantica includes Optical Character Recognition (OCR) capabilities for processing scanned PDFs and image-based documents. This feature uses **Tesseract 5** with **tessdata_best** models to extract high-quality text from PDFs that contain little or no machine-readable text.

**Status:** ✅ Implemented (v1.0.4+)
**Platform:** Cross-platform (macOS, Windows, Linux)
**Default:** Enabled
**Previous:** v1.0.2-1.0.3 used macOS Vision framework (macOS-only)

## Architecture

### High-Level Flow

```
PDF File → TypeScript Parser → Detection Logic → PDF Rasterization (pdfjs-dist) → Tesseract 5 OCR → Extracted Text
```

### Components

#### 1. PDF Parser (TypeScript)
**Location:** `src/main/parsers/pdf.ts`

```typescript
export async function parsePdf(
  filePath: string,
  options?: PDFParserOptions
): Promise<PDFPage[]>
```

**Responsibilities:**
- Try standard text extraction first (pdf-parse)
- Detect if OCR is needed (< 50 chars/page)
- Rasterize PDF pages to PNG images at 300 DPI
- Call Tesseract OCR on each page
- Return unified page structure

**Parser Version:** 5 (Tesseract 5 with tessdata_best)

#### 2. PDF Rasterization (Node.js)
**Location:** `src/main/ocr/pdfToImage.ts`

**Functions:**
- `renderPDFToImages()` - Renders pages to image buffers
- `rasterizePdfToPngs()` - Saves pages as PNG files for Tesseract

**Dependencies:**
- `pdfjs-dist` (v5.4.394) - PDF rendering engine
- `canvas` (node-canvas) - Image rendering for Node.js

**Implementation:**
```typescript
// Render PDF pages at high DPI for OCR
const pngFiles = await rasterizePdfToPngs(pdfPath, tempDir, {
  dpi: 300,  // High quality for accurate OCR
  pages: [1, 2, 3]  // Optional: specific pages
});
```

#### 3. Tesseract OCR Wrapper (Node.js)
**Location:** `src/main/ocr/tesseract.ts`

**Functions:**
- `ocrWithTesseract()` - Main OCR API
- `getTesseractBin()` - Platform-specific binary resolution
- `getTessdataDir()` - Trained models directory
- `isTesseractAvailable()` - Validates OCR setup

**Bundled Assets:**
```
assets/ocr/
├── tessdata_best/          # Trained models (high accuracy)
│   ├── eng.traineddata     # English (~15 MB)
│   ├── fra.traineddata     # French (~3.8 MB)
│   └── osd.traineddata     # Orientation detection (~10 MB)
├── mac-arm64/
│   └── tesseract           # macOS Apple Silicon binary
├── mac-x64/
│   └── tesseract           # macOS Intel binary
├── win-x64/
│   └── tesseract.exe       # Windows 64-bit binary
└── linux-x64/
    └── tesseract           # Linux 64-bit binary
```

**Execution:**
```typescript
const result = await ocrWithTesseract(imagePath, {
  languages: ['eng', 'fra'],  // English + French
  psm: '6',                    // Assume uniform block of text
  oem: '1',                    // LSTM neural nets (best accuracy)
  dpi: '300'                   // Must match rendering DPI
});
```

#### 4. OCR Pipeline (Node.js)
**Location:** `src/main/ocr/index.ts`

**Main Function:**
```typescript
export async function extractTextWithOCR(
  pdfPath: string,
  options: PDFOCROptions
): Promise<PDFOCRResult>
```

**Process:**
1. Create temporary directory
2. Rasterize PDF pages to PNG files (300 DPI)
3. Run Tesseract OCR on each PNG file
4. Combine results from all pages
5. Clean up temporary files
6. Return full text + per-page text

## Detection Algorithm

### When OCR is Used

OCR is automatically triggered when:

1. **Text Density Check:** Average characters per page < 50
   ```typescript
   const avgCharsPerPage = data.text.length / data.numpages;
   const needsOCR = avgCharsPerPage < 50;
   ```

2. **User Setting:** `enableOCR` is true (default)

3. **Tesseract Available:** Bundled binary and models are present

### Detection Flow

```
1. Extract text with pdf-parse
2. Calculate: avg_chars = total_chars / num_pages
3. If avg_chars < 50:
   - Log: "Low text content detected"
   - Check enableOCR setting
   - If enabled: Call isScannedPDF()
   - If needs_ocr: Call extractTextWithOCR()
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
  }
}
```

### Tesseract Options

**Default Configuration:**
```typescript
{
  languages: ['eng', 'fra'],  // English + French support
  psm: '6',                    // Page segmentation mode: uniform block
  oem: '1',                    // OCR Engine mode: LSTM only
  dpi: '300',                  // Image resolution
  timeoutMs: undefined         // No timeout by default
}
```

**PSM (Page Segmentation Mode) Options:**
- `3` - Fully automatic page segmentation (default Tesseract)
- `6` - Assume a single uniform block of text (Semantica default)
- `11` - Sparse text - find as much text as possible

**OEM (OCR Engine Mode) Options:**
- `0` - Legacy engine only
- `1` - LSTM only (Semantica default - best for modern scans)
- `2` - Legacy + LSTM
- `3` - Default, based on what is available

## Performance Characteristics

### Speed

| Operation | Time | Notes |
|-----------|------|-------|
| Standard text extraction | ~100ms/page | pdf-parse only |
| PDF rasterization | ~50-100ms/page | pdfjs-dist rendering |
| Tesseract OCR | ~200-500ms/page | Depends on image size & content |
| **Total (OCR)** | **~250-600ms/page** | Per-page average |

### Memory

| Component | Memory Usage | Notes |
|-----------|--------------|-------|
| Standard PDF | ~20-50MB | Base pdf-parse |
| PDF rendering | ~50-100MB | pdfjs-dist + canvas |
| Tesseract OCR | ~100-200MB peak | Per-process overhead |
| **Total (OCR)** | **~170-350MB peak** | Per document |

### Disk Space

**Bundled Assets:**
- Tesseract binaries: ~5-10 MB per platform
- tessdata_best models: ~29 MB (eng + fra + osd)
- **Total:** ~100-150 MB (all platforms bundled)

**Runtime:**
- Temporary PNG files: ~1-5 MB per page (deleted after OCR)
- No persistent cache (processed on-demand)

## Error Handling

### Graceful Degradation

OCR failures do NOT prevent indexing:

```typescript
try {
  if (isScanned && enableOCR) {
    const ocrResult = await extractTextWithOCR(filePath, {
      languages: ['eng', 'fra'],
      psm: '6',
      dpi: 300
    });
    return ocrResult.pages.map((text, i) => ({ page: i + 1, text }));
  }
} catch (error) {
  logger.error('OCR failed:', error);
  throw new Error(`OCR failed: ${error.message}`);
}
```

### Common Errors

**1. Tesseract Binary Not Found**
- **Cause:** Binary not bundled or wrong platform architecture
- **Behavior:** Error thrown during initialization
- **Mitigation:** Validate with `isTesseractAvailable()`

**2. Trained Models Missing**
- **Cause:** tessdata_best models not bundled
- **Behavior:** Tesseract fails with "failed loading language 'eng'"
- **Mitigation:** Check `assets/ocr/tessdata_best/` contents

**3. File Too Large**
- **Cause:** Memory limits exceeded during rendering
- **Behavior:** Node.js out-of-memory error
- **Mitigation:** Process pages in batches, limit concurrency

**4. Corrupt PDF**
- **Cause:** Invalid PDF structure
- **Behavior:** pdfjs-dist rendering fails
- **User Impact:** File marked as failed

**5. Permission Denied**
- **Cause:** Tesseract binary not executable
- **Behavior:** EACCES error on binary execution
- **Mitigation:** Ensure `chmod +x` on bundled binaries

## Integration with Parser Versioning

### Version History

- **v1**: Initial pdf-parse implementation
- **v2**: Async file reading to prevent blocking
- **v3**: OCR support (macOS Vision framework) - v1.0.2
- **v4**: Node.js native OCR (macOS Vision via @cherrystudio/mac-system-ocr) - v1.0.3
- **v5**: Tesseract 5 with tessdata_best (cross-platform) - v1.0.4 ✅

### Automatic Re-indexing

When PDF parser version updates from v4 → v5:

1. Re-indexing system detects version mismatch
2. Files with `parser_version < 5` queued for re-indexing
3. Previously processed scanned PDFs get re-OCR'd with Tesseract
4. Higher quality text extracted with tessdata_best models

```typescript
// Current parser version
export const PARSER_VERSION = 5; // Tesseract 5 + tessdata_best
```

## Testing

### Unit Tests

**Location:** `tests/unit/parsers.spec.ts`

- PDF header validation
- Error handling for corrupt/invalid PDFs
- Non-PDF file rejection

### Integration Tests

**Location:** `tests/integration/ocr-pipeline.spec.ts`

**Test Cases:**
1. ✅ Small scanned PDF → OCR extraction
2. ✅ Text content verification
3. ✅ Fast vs accurate recognition levels
4. ✅ Multi-language support (English/French)
5. ✅ Scanned PDF detection
6. ✅ Error handling for missing files
7. ⏳ Large real-world PDF (144 MB, 69 pages)

**Test Fixtures:**
- `tests/fixtures/scanned-sample.pdf` (858 bytes, minimal test PDF)
- `/Users/bovet/Downloads/Semantica Test Files/2015 - Book.pdf` (144 MB, real-world)

## Limitations

### Platform-Specific

- **Cross-Platform:** Works on macOS, Windows, Linux ✅
- **Binaries Required:** Must bundle platform-specific Tesseract binary
- **macOS Signing:** Binary must be codesigned for distribution

### Technical

- **Language Support:** Currently bundled: English, French
  - Additional languages available from tessdata_best repository
  - Can be added by including `.traineddata` files
- **Handwriting:** Limited support (tessdata_best is optimized for printed text)
- **Complex Layouts:** Tables, multi-column layouts may have ordering issues
- **Image Quality:** Low-resolution scans (< 200 DPI) produce poor results
- **File Size:** Very large PDFs require significant memory for rendering

### Performance

- **Sequential Processing:** Pages processed one at a time (no parallelization yet)
- **No Caching:** Every OCR request processes from scratch
- **Temporary Files:** Creates PNG files in `/tmp` (cleaned up after processing)
- **Memory-Intensive:** Peak memory ~350MB for large PDFs

## Comparison: Tesseract vs macOS Vision

| Feature | Tesseract 5 (v1.0.4+) | macOS Vision (v1.0.2-1.0.3) |
|---------|----------------------|---------------------------|
| **Platform** | macOS, Windows, Linux | macOS only |
| **Minimum OS** | Any | macOS 12+ (Monterey) |
| **Accuracy** | tessdata_best (very high) | High (Vision framework) |
| **Languages** | eng, fra (bundled) | 50+ (system-dependent) |
| **Speed** | ~250-600ms/page | ~200-300ms/page |
| **Bundle Size** | +100-150 MB | No additional size |
| **Dependencies** | Bundled binary | System framework |
| **Consistency** | Identical across platforms | macOS version-dependent |

### Why We Switched

1. **Cross-Platform Support:** Enables Windows/Linux versions
2. **Consistency:** Same OCR quality on all platforms
3. **Control:** Can update Tesseract/models independently
4. **Offline:** No system dependencies required
5. **Quality:** tessdata_best models provide excellent accuracy

## Future Enhancements

### Potential Improvements

1. **Parallel Processing:** OCR multiple pages concurrently (semaphore-based)
2. **Progress Reporting:** Real-time OCR progress for large documents (already supported via callback)
3. **Caching:** Store OCR results to avoid reprocessing identical files
4. **Quality Settings:** User-selectable PSM/OEM modes
5. **Additional Languages:** Bundle more tessdata_best models (spa, deu, ita, etc.)
6. **JSON Output:** Use Tesseract 5.3+ `--json` mode for structured data

### Platform Expansion

- **Windows Binaries:** Add `assets/ocr/win-x64/tesseract.exe` + DLLs
- **Linux Binaries:** Add `assets/ocr/linux-x64/tesseract` (glibc + musl)
- **macOS x64:** Add `assets/ocr/mac-x64/tesseract` for Intel Macs

### Out of Scope

- Video OCR (motion text recognition)
- Real-time OCR (live camera feed)
- Image format support (JPEG, PNG, etc.) - PDFs only
- Cloud OCR services (Google Vision, AWS Textract, etc.)

## References

### Implementation Files

- **PDF Parser:** `src/main/parsers/pdf.ts`
- **OCR Pipeline:** `src/main/ocr/index.ts`
- **Tesseract Wrapper:** `src/main/ocr/tesseract.ts`
- **PDF Rasterization:** `src/main/ocr/pdfToImage.ts`
- **Configuration:** `src/shared/config/configIO.ts`
- **Settings UI:** `src/renderer/components/settings/FileTypesSettings.tsx`

### Assets

- **Binaries:** `assets/ocr/{platform}/tesseract`
- **Models:** `assets/ocr/tessdata_best/*.traineddata`
- **README:** `assets/README.md` (download instructions)

### External Resources

- **Tesseract GitHub:** https://github.com/tesseract-ocr/tesseract
- **tessdata_best:** https://github.com/tesseract-ocr/tessdata_best
- **Tesseract Documentation:** https://tesseract-ocr.github.io/

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.2 | 2025-01-XX | Initial OCR with macOS Vision (Python sidecar) |
| 1.0.3 | 2025-01-XX | Node.js native OCR (macOS Vision via @cherrystudio/mac-system-ocr) |
| 1.0.4 | 2025-01-XX | **Tesseract 5 + tessdata_best** (cross-platform, bundled binaries) |

## Migration Notes (v1.0.3 → v1.0.4)

### Removed Dependencies

- `@cherrystudio/mac-system-ocr` npm package
- macOS Vision framework reliance
- `src/main/ocr/visionOCR.ts` (deleted)

### Added Dependencies

- Tesseract 5 binaries (bundled in `assets/ocr/`)
- tessdata_best models (bundled in `assets/ocr/tessdata_best/`)
- Updated `pdfjs-dist` to v5.4.394

### Breaking Changes

**API Changes:**
- `PDFOCROptions` interface updated (removed Vision-specific options)
- Removed: `recognition_level`, `language` (string)
- Added: `languages` (array), `psm`, `oem`, `dpi` (number)

**Before (v1.0.3):**
```typescript
const result = await extractTextWithOCR(filePath, {
  recognition_level: 'accurate',
  language: 'en-US',
  dpi: 200
});
```

**After (v1.0.4):**
```typescript
const result = await extractTextWithOCR(filePath, {
  languages: ['eng', 'fra'],
  psm: '6',
  oem: '1',
  dpi: 300
});
```

**Result Structure:**
- Removed: `confidence` field (Tesseract doesn't provide confidence easily)
- Added: `languages` field (array of languages used)

### Re-indexing Required

All PDFs with `parser_version < 5` will be automatically re-indexed to use Tesseract OCR.
