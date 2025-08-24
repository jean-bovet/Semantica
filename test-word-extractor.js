const WordExtractor = require('word-extractor');
const extractor = new WordExtractor();

const filePath = '/Users/bovet/Documents/Family/Jean/Courrier/2000/Lettre du 17 décembre.doc';

console.log('Testing word-extractor on:', filePath);

extractor.extract(filePath)
  .then(doc => {
    console.log('\n✓ Successfully extracted text from .doc file!\n');
    console.log('Document body length:', doc.getBody().length, 'characters');
    console.log('\n--- FULL TEXT ---\n');
    console.log(doc.getBody());
    console.log('\n--- END ---\n');
    
    // Check for specific content
    const text = doc.getBody().toLowerCase();
    console.log('Contains "benacloche"?', text.includes('benacloche'));
    console.log('Contains "décembre"?', text.includes('décembre'));
    console.log('Contains "17"?', text.includes('17'));
    console.log('Contains "2000"?', text.includes('2000'));
    
    // Get metadata if available
    const annotations = doc.getAnnotations();
    const headers = doc.getHeaders();
    const footers = doc.getFooters();
    
    if (headers) console.log('\nHeaders:', headers);
    if (footers) console.log('Footers:', footers);
    if (annotations) console.log('Annotations:', annotations);
  })
  .catch(err => {
    console.error('Error extracting:', err);
  });