# OCR Research and Findings

**Status:** Research Complete - Implementation Disabled
**Date:** 2025-01-08
**Reason:** pdf.js inline image rendering incompatibility in Node.js

---

## Executive Summary

Attempted to implement cross-platform OCR using **Tesseract 5 + tessdata_best** models. The implementation was blocked by a fundamental incompatibility between pdf.js's inline image decoder and Node.js/node-canvas polyfills. OCR functionality has been removed from the codebase, but all research and findings are preserved in this document for future reference.

---

## Problem Statement

**Goal:** Extract text from scanned PDFs (image-based PDFs with no embedded text layer) to enable semantic search.

**Requirements:**
- Cross-platform (macOS, Windows, Linux)
- Offline operation (no cloud APIs)
- Bundled with application (zero-install)
- High accuracy text extraction
- Reasonable performance (<60s per page)

---

## Attempted Solution: Tesseract 5

### Architecture

**Flow:**
```
Scanned PDF
  ↓
Detect if OCR needed (<50 chars/page threshold)
  ↓
Render PDF pages to PNG images (pdf.js + node-canvas)
  ↓
Run Tesseract OCR on each PNG
  ↓
Combine extracted text
  ↓
Index for semantic search
```

### Implementation Details

**Components:**
1. **PDF Rasterization:** `src/main/ocr/pdfToImage.ts`
   - Used `pdfjs-dist` for PDF rendering
   - Used `node-canvas` for image buffers
   - Rendered at 300 DPI for quality

2. **Tesseract Wrapper:** `src/main/ocr/tesseract.ts`
   - Platform detection (darwin/win32/linux, arm64/x64)
   - Subprocess execution of Tesseract binary
   - TESSDATA_PREFIX environment configuration

3. **OCR Pipeline:** `src/main/ocr/index.ts`
   - PDF → PNG conversion
   - Sequential page processing
   - Temporary file management
   - Progress callbacks

**Assets Bundled:**
- Tesseract 5.5.1 binary (mac-arm64)
- tessdata_best models:
  - `eng.traineddata` (15 MB)
  - `fra.traineddata` (3.8 MB)
  - `osd.traineddata` (10 MB)

**Configuration:**
- Languages: eng + fra
- PSM (Page Segmentation Mode): 6 (uniform block of text)
- OEM (OCR Engine Mode): 1 (LSTM only, best accuracy)
- DPI: 300 (high quality)

---

## The Blocker: pdf.js "Image or Canvas expected" Error

### Root Cause

**pdf.js can decode inline images using code paths that assume a browser environment with native `Image` and `Canvas` classes.** In Node.js, even with `node-canvas` polyfills, certain PDFs trigger this error.

**Specific Issue:**
- The test PDF (`2015 - Book.pdf`, 144 MB, 69 pages) contains **inline images** embedded directly in the PDF content stream
- pdf.js's inline image decoder checks for `Image`/`Canvas` in a way that polyfills don't satisfy
- Error occurs during `page.render()` call, deep in pdf.js internals

### Attempted Fixes (All Failed)

1. **Added NodeCanvasFactory**
   ```typescript
   class NodeCanvasFactory {
     create(width, height) {
       const canvas = createCanvas(width, height);
       const context = canvas.getContext('2d');
       return { canvas, context };
     }
   }
   ```
   **Result:** Still failed

2. **Set globalThis.Image**
   ```typescript
   globalThis.Image = Image; // from node-canvas
   ```
   **Result:** Still failed

3. **Disabled eval-based image decoding**
   ```typescript
   getDocument({
     data,
     isEvalSupported: false,
     canvasFactory: new NodeCanvasFactory()
   })
   ```
   **Result:** Still failed

4. **Comprehensive polyfills**
   ```typescript
   globalThis.Image = Image;
   globalThis.HTMLCanvasElement = createCanvas(0, 0).constructor;
   globalThis.HTMLImageElement = Image;
   globalThis.Canvas = createCanvas(0, 0).constructor;
   ```
   **Result:** Still failed

### Why Polyfills Don't Work

pdf.js's inline image decoder likely:
- Checks object prototypes (not just typeof)
- Uses instanceof checks (polyfills don't pass)
- Expects browser-specific properties/methods
- Has hardcoded assumptions about DOM objects

**Conclusion:** pdf.js is designed for browser environments. Using it headlessly in Node.js for PDFs with inline images is unreliable.

---

## Recommended Solution: Adopt PDFium or Native Rasterizer

**pdf.js is excellent for text extraction and vector rendering in browsers, but for offline, headless, guaranteed rasterization, use a real PDF rasterizer.**

### Option 1: PDFium Sidecar (Recommended)

**What:** Bundle a CLI built with PDFium (Chrome's PDF engine)

**Advantages:**
- ✅ **BSD-3 license** (safe for commercial, closed-source apps)
- ✅ Handles all PDF features (inline images, JPX, JBIG2, transparency, fonts)
- ✅ Cross-platform (macOS, Windows, Linux)
- ✅ Same engine Chrome uses (battle-tested)
- ✅ No DOM hacks or polyfills needed

**Implementation:**
```bash
# CLI usage
pdfium-render --in input.pdf --out-dir /tmp/ocr --dpi 300 --start 1 --end 3

# Output: /tmp/ocr/page-001.png, page-002.png, page-003.png
```

**Electron wrapper:**
```typescript
async function rasterizePdfWithPdfium(pdfPath: string, outDir: string, dpi=300) {
  const bin = getPdfiumBin(); // resolve from process.resourcesPath/pdfium/
  await execFileAsync(bin, [
    "--in", pdfPath,
    "--out-dir", outDir,
    "--dpi", String(dpi)
  ]);
  // Return array of generated PNG file paths
}
```

**Next Steps:**
1. Build PDFium CLI (C++ with libpng)
2. Bundle per platform in `assets/pdfium/{darwin-arm64,win32-x64,linux-x64}/`
3. Replace pdf.js rasterization with PDFium calls
4. Keep Tesseract wrapper exactly as-is

**Licensing:** PDFium is BSD-3, fully compatible with closed-source Electron apps.

---

### Option 2: macOS Quartz (macOS-only, short-term)

**What:** Use Apple's CoreGraphics/Quartz via a tiny Swift CLI

**Advantages:**
- ✅ Clean macOS solution (no GPL/AGPL)
- ✅ System framework (no external dependencies)
- ✅ ~150 lines of Swift code
- ✅ Handles all PDF features natively

**Implementation:**
```swift
// Swift CLI: PDFQuartzRender.swift
import CoreGraphics
import ImageIO

func renderPDFPage(pdfPath: String, page: Int, dpi: Int, outPath: String) {
  let url = URL(fileURLWithPath: pdfPath)
  let doc = CGPDFDocument(url)!
  let pdfPage = doc.page(at: page)!

  let width = Int(pdfPage.getBoxRect(.mediaBox).width * CGFloat(dpi) / 72.0)
  let height = Int(pdfPage.getBoxRect(.mediaBox).height * CGFloat(dpi) / 72.0)

  let colorSpace = CGColorSpaceCreateDeviceRGB()
  let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue
  let context = CGContext(data: nil, width: width, height: height,
                          bitsPerComponent: 8, bytesPerRow: width * 4,
                          space: colorSpace, bitmapInfo: bitmapInfo)!

  context.scaleBy(x: CGFloat(dpi) / 72.0, y: CGFloat(dpi) / 72.0)
  context.drawPDFPage(pdfPage)

  let image = context.makeImage()!
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath),
                                              kUTTypePNG, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  CGImageDestinationFinalize(dest)
}
```

**Limitations:**
- macOS only (need separate Windows/Linux solution)
- Requires bundling Swift runtime (or static linking)

---

### Option 3: Graceful Degradation Strategy

**Implement fallback chain:**

```typescript
async function renderToPngs(pdfPath: string, outDir: string) {
  // Try pdf.js first (fast for simple PDFs)
  try {
    return await renderWithPdfJs(pdfPath, outDir, 300);
  } catch (e) {
    logger.warn('pdf.js failed, trying fallback...');
  }

  // macOS: Try native Quartz
  if (process.platform === 'darwin') {
    try { return await rasterizeWithQuartz(pdfPath, outDir, 300); } catch {}
    try { return await rasterizeWithSips(pdfPath, outDir, 300); } catch {}
  }

  // Cross-platform: Try PDFium (if bundled)
  try {
    return await rasterizePdfWithPdfium(pdfPath, outDir, 300);
  } catch (e) {
    logger.error('All PDF rasterizers failed');
  }

  // Last resort
  throw new Error('Cannot render this PDF. Try exporting as images manually.');
}
```

---

## Alternative: macOS `sips` Command (Quick Fix)

**What:** Use macOS's built-in `sips` tool as emergency fallback

**Usage:**
```bash
sips -s format png -s dpiHeightWidth 300 input.pdf --out /tmp/page-1.png
```

**Limitations:**
- Only renders first page by default
- macOS only
- Inconsistent across OS versions

**Use Case:** Temporary unblock for development/testing on macOS

---

## Why Not Keep Fighting pdf.js?

**Reasons to move on:**

1. **Brittle polyfills** - Edge cases keep appearing (inline images, JPX, JBIG2, rare color spaces)
2. **Version churn** - pdf.js updates break Node.js compatibility regularly
3. **Not designed for this** - pdf.js is optimized for browser rendering, not headless rasterization
4. **Better alternatives exist** - PDFium, MuPDF, Poppler are purpose-built for this

**Recommendation:** Use pdf.js for text extraction and scanned PDF detection (< 50 chars/page check). Use a real PDF rasterizer (PDFium) for image rendering.

---

## Performance Expectations (If Implemented)

| Metric | Estimated Value |
|--------|-----------------|
| Speed (per page) | ~250-600ms (Tesseract 5 + tessdata_best) |
| Memory (peak) | ~170-350MB |
| Bundle size | +100-150 MB (Tesseract + models + PDFium) |
| Accuracy | Very high (tessdata_best models) |
| Languages | eng, fra (extensible to 100+ languages) |

---

## Files Removed

**Source Code:**
- `src/main/ocr/` (entire directory)
  - `index.ts` - OCR pipeline
  - `tesseract.ts` - Tesseract wrapper
  - `visionOCR.ts` - Old macOS Vision implementation
  - `pdfToImage.ts` - PDF rendering (broken)

**Tests:**
- `tests/integration/ocr-pipeline.spec.ts`
- `scripts/test-tesseract-ocr.ts`
- `scripts/test-node-ocr.{js,mjs}`
- `scripts/README-tesseract-test.md`

**Assets:**
- `assets/ocr/` (entire directory)
  - Tesseract binaries
  - tessdata_best models

**Dependencies (package.json):**
- `@cherrystudio/mac-system-ocr` (old macOS Vision binding)
- `canvas` (node-canvas for rendering)

**Configuration:**
- `enableOCR` setting removed from config
- OCR checkbox removed from Settings UI

---

## License Considerations for PDF Rasterizers

| Library | License | Commercial OK? | Notes |
|---------|---------|----------------|-------|
| **PDFium** | BSD-3 | ✅ Yes | Chrome's engine, permissive |
| MuPDF | AGPL | ❌ No (requires commercial license) | Technically excellent, license tricky |
| Poppler | GPL | ❌ No (requires commercial license) | Widely used, but GPL |
| Ghostscript | AGPL | ❌ No (requires commercial license) | ImageMagick delegates to this |
| macOS Quartz | Apple System | ✅ Yes (macOS only) | Free for macOS, can't bundle cross-platform |

**Recommendation:** PDFium (BSD-3) for commercial Electron app.

---

## Next Steps (If Resuming OCR Work)

1. **Build PDFium CLI**
   - Create minimal C++ wrapper around PDFium
   - Input: PDF path, page range, DPI
   - Output: PNG files
   - Build for darwin-arm64, darwin-x64, win32-x64, linux-x64

2. **Bundle PDFium binaries**
   - Add to `assets/pdfium/{platform}/pdfium-render`
   - Update `package.json` extraResources
   - Platform detection logic

3. **Restore Tesseract wrapper**
   - `src/main/ocr/tesseract.ts` was solid, can reuse as-is
   - Already handles platform detection, TESSDATA_PREFIX, subprocess

4. **Implement OCR pipeline with PDFium**
   ```typescript
   // New flow
   PDF → PDFium (render to PNGs) → Tesseract (OCR each PNG) → Text
   ```

5. **Re-enable OCR UI**
   - Restore `enableOCR` setting
   - Restore Settings checkbox
   - Add progress indicators

6. **Test with real scanned PDFs**
   - Verify 100% success rate on inline image PDFs
   - Benchmark performance
   - Test cross-platform

---

## References

- **Tesseract:** https://github.com/tesseract-ocr/tesseract
- **tessdata_best:** https://github.com/tesseract-ocr/tessdata_best
- **PDFium:** https://pdfium.googlesource.com/pdfium/
- **pdf.js:** https://mozilla.github.io/pdf.js/
- **node-canvas:** https://github.com/Automattic/node-canvas

---

## Lessons Learned

1. **Browser libraries ≠ Node.js libraries** - Even with polyfills, DOM-dependent code is fragile in Node.js
2. **Test with real data early** - Simple test PDFs worked, but production PDFs broke everything
3. **License matters** - PDFium's BSD-3 is critical for commercial apps (vs AGPL alternatives)
4. **Platform-specific is OK temporarily** - macOS Quartz is a valid short-term solution
5. **Document failure modes** - This document saves future developers days of debugging

---

## Conclusion

OCR for scanned PDFs is a valuable feature, but **pdf.js is the wrong tool for headless PDF rasterization in Node.js**. The path forward is:

1. **Short-term:** Skip OCR for now (users can manually convert scanned PDFs)
2. **Medium-term:** Adopt PDFium sidecar for reliable, cross-platform rasterization
3. **Long-term:** Keep Tesseract as OCR engine, replace only the rasterization layer

**All research and implementation details are preserved in this document for when work resumes.**
