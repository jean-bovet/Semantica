const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

// Create a simple HTTP server for testing auto-updates
const server = http.createServer((req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  
  // CORS headers for electron-updater
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  
  // Parse URL to ignore query parameters
  const url = req.url.split('?')[0];
  
  if (url === '/latest-mac.yml' || url === '/latest-mac.yaml') {
    // Serve the update manifest
    const yamlPath = path.join(__dirname, 'latest-mac.yml');
    if (fs.existsSync(yamlPath)) {
      const content = fs.readFileSync(yamlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/yaml' });
      res.end(content);
      console.log('  -> Served latest-mac.yml');
    } else {
      res.writeHead(404);
      res.end('latest-mac.yml not found');
      console.log('  -> 404: latest-mac.yml not found');
    }
  } else if (url === '/Semantica-1.0.2-arm64-mac.zip' || url === '/Semantica-1.0.2-mac.zip') {
    // For testing, we'll just return a small dummy ZIP file
    // In real testing, you'd serve an actual ZIP file with the app
    res.writeHead(200, { 
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="Semantica-1.0.2-arm64-mac.zip"'
    });
    // Create a minimal valid ZIP file (ZIP header)
    const zipHeader = Buffer.from([0x50, 0x4B, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 
                                   0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                                   0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    res.end(zipHeader);
    console.log('  -> Served mock ZIP file');
  } else if (url === '/Semantica-1.0.2-arm64.dmg' || url === '/Semantica-1.0.2.dmg') {
    // For testing, we'll just return a small dummy file
    // In real testing, you'd serve an actual DMG file
    res.writeHead(200, { 
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="Semantica-1.0.2.dmg"'
    });
    res.end(Buffer.from('This is a mock DMG file for testing'));
    console.log('  -> Served mock DMG file');
  } else if (url === '/Semantica-1.0.2-arm64.dmg.blockmap' || url === '/Semantica-1.0.2.dmg.blockmap' || 
             url === '/Semantica-1.0.2-arm64-mac.zip.blockmap') {
    // Blockmap is optional but electron-updater might request it
    res.writeHead(404);
    res.end('Blockmap not available');
    console.log('  -> 404: Blockmap not available (this is OK)');
  } else {
    res.writeHead(404);
    res.end('Not found');
    console.log(`  -> 404: ${url} (full: ${req.url})`);
  }
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║  Mock Update Server for Semantica                       ║
║  Running on http://localhost:${PORT}                       ║
║                                                          ║
║  Available endpoints:                                    ║
║  - http://localhost:${PORT}/latest-mac.yml                 ║
║  - http://localhost:${PORT}/Semantica-1.0.2-arm64-mac.zip     ║
║  - http://localhost:${PORT}/Semantica-1.0.2.dmg            ║
║                                                          ║
║  To test auto-update:                                    ║
║  1. Make sure latest-mac.yml exists in this directory   ║
║  2. Run: npm run test:update (from another terminal)    ║
╚════════════════════════════════════════════════════════╝
  `);
});