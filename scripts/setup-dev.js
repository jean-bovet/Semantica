#!/usr/bin/env node

// This script sets up the development environment by creating a symlink
// from dist/node_modules to app/node_modules so the worker can find modules

const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, '..', 'dist', 'node_modules');
const sourcePath = path.join(__dirname, '..', 'app', 'node_modules');

// Remove old symlink or directory if it exists
if (fs.existsSync(distPath)) {
  try {
    fs.rmSync(distPath, { recursive: true, force: true });
  } catch (e) {
    // Ignore errors
  }
}

// Create parent directory if needed
const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Create symlink for development
try {
  fs.symlinkSync(sourcePath, distPath, 'junction');
  console.log('✓ Development environment ready (symlinked dist/node_modules -> app/node_modules)');
} catch (e) {
  console.error('Failed to create symlink:', e.message);
  console.log('You may need to run this script with elevated privileges.');
}