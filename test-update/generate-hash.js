const crypto = require('crypto');

// Create the same minimal ZIP file we serve
const zipHeader = Buffer.from([0x50, 0x4B, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 
                               0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                               0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

// Calculate SHA512 hash
const hash = crypto.createHash('sha512');
hash.update(zipHeader);
const sha512 = hash.digest('base64');

console.log('SHA512 hash for mock ZIP file:');
console.log(sha512);
console.log('\nUpdate latest-mac.yml with this hash.');