#!/usr/bin/env node

/**
 * Script to add profiling-enabled npm scripts to package.json
 * Run this once to add the new scripts
 */

const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Add new profiling scripts
const newScripts = {
  "dev:profile": "PROFILE=true node scripts/setup-dev.js && PROFILE=true concurrently -k -n VITE,BUILD,ELEC -c blue,magenta,green \"vite\" \"node esbuild.watch.mjs\" \"PROFILE=true wait-on tcp:5173 && PROFILE=true electronmon .\"",
  "profile": "PROFILE=true npm run dev",
  "profile:analyze": "node scripts/analyze-profile.js"
};

// Merge with existing scripts
pkg.scripts = {
  ...pkg.scripts,
  ...newScripts
};

// Write back
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 4));

console.log('✅ Added profiling scripts to package.json');
console.log('\nYou can now use:');
console.log('  npm run dev:profile   - Run with profiling enabled');
console.log('  npm run profile       - Shorthand for dev:profile');
console.log('  npm run profile:analyze - Analyze latest profile report');