#!/usr/bin/env node

/**
 * Prototype test script for Node.js OCR pipeline
 * Tests: PDF → Image → macOS Vision OCR
 */

const fs = require('fs');
const path = require('path');
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');
const { createCanvas } = require('canvas');
const MacOCR = require('@cherrystudio/mac-system-ocr');

// Test with the scanned sample PDF
const PDF_PATH = path.join(__dirname, '../tests/fixtures/scanned-sample.pdf');

async function pdfToImage(pdfPath, pageNum = 1, dpi = 200) {
  console.log(`\n📄 Loading PDF: ${pdfPath}`);

  // Load the PDF
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    standardFontDataUrl: path.join(__dirname, '../node_modules/pdfjs-dist/standard_fonts/')
  });

  const pdfDocument = await loadingTask.promise;
  console.log(`   Total pages: ${pdfDocument.numPages}`);

  // Get the page
  const page = await pdfDocument.getPage(pageNum);
  const viewport = page.getViewport({ scale: dpi / 72 });

  console.log(`\n🖼️  Rendering page ${pageNum} at ${dpi} DPI`);
  console.log(`   Dimensions: ${Math.round(viewport.width)}x${Math.round(viewport.height)}px`);

  // Create canvas
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');

  // Render the page
  await page.render({
    canvasContext: context,
    viewport: viewport
  }).promise;

  // Convert to PNG buffer
  const imageBuffer = canvas.toBuffer('image/png');
  console.log(`   Image size: ${(imageBuffer.length / 1024).toFixed(1)} KB`);

  await pdfDocument.destroy();

  return imageBuffer;
}

async function ocrImage(imageBuffer) {
  console.log(`\n🔍 Running macOS Vision OCR...`);

  // Save image temporarily (mac-system-ocr requires file path)
  const tempPath = path.join(__dirname, '../temp-ocr-test.png');
  fs.writeFileSync(tempPath, imageBuffer);

  const startTime = Date.now();

  try {
    // Run OCR
    const result = await MacOCR.recognizeFromPath(tempPath);

    const duration = Date.now() - startTime;
    console.log(`   OCR completed in ${duration}ms`);
    console.log(`   Extracted ${result.length} characters`);

    return result;
  } finally {
    // Clean up temp file
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   Node.js OCR Pipeline Prototype Test             ║');
  console.log('╚════════════════════════════════════════════════════╝');

  try {
    // Step 1: Convert PDF to image
    const imageBuffer = await pdfToImage(PDF_PATH, 1, 200);

    // Step 2: Run OCR
    const ocrText = await ocrImage(imageBuffer);

    // Display results
    console.log('\n✅ SUCCESS!');
    console.log('\n📝 Extracted Text:');
    console.log('─────────────────────────────────────────────────────');
    console.log(ocrText.substring(0, 500) + (ocrText.length > 500 ? '...' : ''));
    console.log('─────────────────────────────────────────────────────');
    console.log(`\nFull text length: ${ocrText.length} characters`);

    // Test with different DPI
    console.log('\n\n🔬 Testing different DPI settings...');
    const dpis = [150, 200, 300];

    for (const dpi of dpis) {
      const img = await pdfToImage(PDF_PATH, 1, dpi);
      const text = await ocrImage(img);
      console.log(`   ${dpi} DPI: ${text.length} chars extracted`);
    }

    console.log('\n✅ All tests passed!');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
