# Build Instructions for Semantica

## Quick Start

```bash
npm run dev
```

## Clean Rebuild

If you encounter module loading errors or need a fresh build:

```bash
# 1. Stop all running processes
killall node electron || true

# 2. Clean all build artifacts
rm -rf dist/ dist-web/ app/dist/ node_modules/.cache/

# 3. Rebuild everything
npm run build

# 4. Start development server
npm run dev
```

## How the Build Works

### Two-Package Architecture
Following the optimization strategy from `specs/app-size-optimization-complete.md`:
- **Main package.json** - Development dependencies only
- **app/package.json** - Runtime dependencies only
- **app/dist/** - Built application code

### Module Resolution
- **Development**: Creates symlink from `dist/node_modules` to `app/node_modules` via `scripts/setup-dev.js`
- **Production**: Worker finds modules in the ASAR archive or app.asar.unpacked for native modules

### Build Scripts

- **`npm run dev`** - Starts development server with hot reload
  1. Creates symlink for node_modules (dev only)
  2. Starts Vite dev server
  3. Watches TypeScript files with esbuild
  4. Launches Electron with electronmon

- **`npm run build`** - Production build
  1. Compiles TypeScript
  2. Bundles with esbuild
  3. Builds frontend with Vite
  4. Copies dist to app/ directory
  5. Installs production dependencies in app/

- **`npm run dist`** - Creates distributable DMG
  1. Runs full build
  2. Packages with electron-builder

## Troubleshooting

### "Cannot find module" Errors

If you see errors like:
```
Error: Cannot find module '@lancedb/lancedb'
```

Run the clean rebuild steps above. This ensures the symlink is properly created.

### Port Already in Use

If port 5173 is already in use:
```bash
killall node
```

### Manual Development Setup

If the automatic symlink fails, create it manually:
```bash
rm -rf dist/node_modules
ln -s $(pwd)/app/node_modules dist/node_modules
```

## Dependencies

The app requires these external modules at runtime:
- `@lancedb/lancedb` - Vector database
- `apache-arrow` - Data format for LanceDB
- Various parsers for document processing

These are kept as external dependencies (not bundled) to avoid native module issues.

## Production Build Configuration

Following the optimization strategy from `specs/app-size-optimization-complete.md`:
- **ASAR enabled** with `asarUnpack` for native modules
- **Two-package architecture** - Separates dev and runtime dependencies
- **NODE_ENV set to production** - Ensures correct paths are used
- **Models downloaded on-demand** - Not bundled with app (saves 135MB)