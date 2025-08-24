const fs = require('fs');

const filePath = '/Users/bovet/Documents/Family/Jean/Courrier/2000/Lettre du 17 décembre.doc';

console.log('Reading file:', filePath);
console.log('File exists:', fs.existsSync(filePath));

if (fs.existsSync(filePath)) {
  const stats = fs.statSync(filePath);
  console.log('File size:', stats.size, 'bytes');
  
  // Read first 1000 bytes to check file format
  const buffer = fs.readFileSync(filePath);
  
  // Check if it's an RTF file (starts with {\rtf)
  const header = buffer.toString('utf8', 0, Math.min(1000, buffer.length));
  console.log('\nFirst 200 chars of file:');
  console.log(header.substring(0, 200));
  
  // Check for RTF signature
  if (header.startsWith('{\\rtf')) {
    console.log('\n✓ File appears to be RTF format');
  } else {
    console.log('\n✗ File does not appear to be RTF format');
    
    // Check for DOC signature (MS Word binary)
    const magicBytes = buffer.toString('hex', 0, 8);
    console.log('Magic bytes (hex):', magicBytes);
    
    if (magicBytes.startsWith('d0cf11e0')) {
      console.log('✓ File is Microsoft Compound Binary Format (old .doc)');
      console.log('This format requires special parsing that may not be supported');
    }
  }
  
  // Try to find any readable text
  console.log('\nSearching for readable text in file...');
  const text = buffer.toString('utf8', 0, buffer.length).replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');
  
  // Look for common words
  const searchTerms = ['benacloche', 'décembre', 'lettre', 'jean', '2000', '17'];
  console.log('\nSearching for terms:');
  searchTerms.forEach(term => {
    const found = text.toLowerCase().includes(term.toLowerCase());
    console.log(`  "${term}": ${found ? '✓ FOUND' : '✗ not found'}`);
    if (found) {
      const index = text.toLowerCase().indexOf(term.toLowerCase());
      const snippet = text.substring(Math.max(0, index - 50), Math.min(text.length, index + 50));
      console.log(`    Context: ...${snippet}...`);
    }
  });
}