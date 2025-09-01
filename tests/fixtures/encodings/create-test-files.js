const fs = require('fs');
const iconv = require('iconv-lite');
const path = require('path');

// Create test files with different encodings
const testData = {
  'utf8.txt': {
    encoding: 'utf8',
    content: 'This is UTF-8 text with special chars: café, naïve, €100, 日本語'
  },
  'iso-8859-1.txt': {
    encoding: 'ISO-8859-1',
    content: 'This is ISO-8859-1 (Latin-1) text: café, naïve, £100, ©2024'
  },
  'windows-1252.txt': {
    encoding: 'windows-1252',
    content: 'This is Windows-1252 text: "smart quotes", €uro, café'
  },
  'utf16le.txt': {
    encoding: 'utf16le',
    content: 'This is UTF-16LE text: café, 日本語, emoji: 😀'
  },
  'ascii.txt': {
    encoding: 'ascii',
    content: 'This is plain ASCII text without special characters'
  },
  'macroman.txt': {
    encoding: 'macintosh',
    content: 'This is Mac Roman text: café, Option+8 bullet • and © symbol'
  }
};

const dir = __dirname;

for (const [filename, data] of Object.entries(testData)) {
  const filepath = path.join(dir, filename);
  const buffer = iconv.encode(data.content, data.encoding);
  fs.writeFileSync(filepath, buffer);
  console.log(`Created ${filename} with ${data.encoding} encoding`);
}

// Also create a file with mixed content (Pascal code like the user's files)
const pascalCode = `(*********************************************************************************)\n(*                                                                               *)\n(*  (c) copyright 1983, 1984  Apple Computer Inc.                                *)\n(*                                                                               *)\n(*********************************************************************************)\n\nprocedure TestProcedure;\nvar\n  résultat: integer;  { French variable name }\n  größe: real;        { German variable name }\nbegin\n  writeln('Testing special chars: café, naïve');\n  résultat := 42;\n  größe := 3.14;\nend;`;

fs.writeFileSync(
  path.join(dir, 'pascal-iso-8859-1.txt'),
  iconv.encode(pascalCode, 'ISO-8859-1')
);
console.log('Created pascal-iso-8859-1.txt with ISO-8859-1 encoding');

console.log('\nAll test files created successfully!');