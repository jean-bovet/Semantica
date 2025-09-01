#!/bin/bash

# Build script for signed and notarized macOS distribution
# Usage: ./scripts/build-signed.sh

set -e  # Exit on error

echo "🚀 Starting signed build process..."

# Check for required environment variables
if [ -z "$APPLE_ID" ]; then
  echo "⚠️  Warning: APPLE_ID not set. Build will not be notarized."
  echo "   To enable notarization, set environment variables:"
  echo "   - APPLE_ID"
  echo "   - APPLE_APP_SPECIFIC_PASSWORD"
  echo "   - APPLE_TEAM_ID"
  echo ""
  echo "   You can source .env.local if you have one:"
  echo "   source .env.local"
  echo ""
  read -p "Continue without notarization? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist dist-app app/dist

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Install notarize package if not present
if ! npm list @electron/notarize &>/dev/null; then
  echo "📦 Installing @electron/notarize..."
  npm install --save-dev @electron/notarize
fi

# Build the application
echo "🔨 Building application..."
npm run build

# Package and sign
echo "📦 Packaging and signing..."
if [ -z "$APPLE_ID" ]; then
  echo "   Building without notarization..."
  npm run dist
else
  echo "   Building with notarization (this may take 5-30 minutes)..."
  npm run dist
fi

# Verify the build
if [ -f "dist-app/mac/Finder Semantic Search.app" ]; then
  echo ""
  echo "✅ Build complete!"
  echo ""
  echo "📍 Output location: dist-app/"
  
  # List output files
  echo "📦 Generated files:"
  ls -lh dist-app/*.dmg 2>/dev/null || echo "   No .dmg files generated"
  ls -lh dist-app/*.zip 2>/dev/null || echo "   No .zip files generated"
  
  # Verify signature if on macOS
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo ""
    echo "🔍 Verifying code signature..."
    if [ -d "dist-app/mac/Finder Semantic Search.app" ]; then
      codesign --verify --deep --strict "dist-app/mac/Finder Semantic Search.app" && \
        echo "   ✅ Code signature valid" || \
        echo "   ❌ Code signature invalid"
      
      if [ ! -z "$APPLE_ID" ]; then
        echo ""
        echo "🔍 Checking notarization status..."
        spctl -a -t exec -vv "dist-app/mac/Finder Semantic Search.app" 2>&1 | grep -E "accepted|notarized" && \
          echo "   ✅ App is notarized" || \
          echo "   ⚠️  App may not be notarized yet"
      fi
    fi
  fi
else
  echo "❌ Build failed - app not found"
  exit 1
fi

echo ""
echo "🎉 Done! Your signed app is ready for distribution."
echo ""
echo "Next steps:"
echo "1. Test the .dmg file on a clean Mac"
echo "2. Upload to your distribution channel"
echo "3. Create release notes"