const fs = require('fs');
const path = require('path');

// Import the parser
const { parseRtf } = require('./dist/parsers/rtf.cjs');

async function testDocFile() {
  const filePath = '/Users/bovet/Documents/Family/Jean/Courrier/2000/Lettre du 17 décembre.doc';
  
  console.log('Testing file:', filePath);
  console.log('File exists:', fs.existsSync(filePath));
  
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    console.log('File size:', stats.size, 'bytes');
    
    try {
      console.log('\nAttempting to parse as RTF...');
      const text = await parseRtf(filePath);
      console.log('\nExtracted text length:', text.length);
      console.log('\nFirst 500 characters:');
      console.log(text.substring(0, 500));
      console.log('\n...\n');
      console.log('Last 500 characters:');
      console.log(text.substring(text.length - 500));
      
      // Check for specific terms
      console.log('\nContains "benacloche"?', text.toLowerCase().includes('benacloche'));
      console.log('Contains "décembre"?', text.toLowerCase().includes('décembre'));
      
    } catch (error) {
      console.error('Error parsing file:', error.message);
      console.error('Stack:', error.stack);
    }
  }
}

testDocFile().catch(console.error);