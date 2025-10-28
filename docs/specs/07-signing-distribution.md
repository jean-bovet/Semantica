# App Signing & Distribution

*Previous: [06-build-optimization.md](./06-build-optimization.md) | Next: [08-startup-flow.md](./08-startup-flow.md)*

---

## Overview
This guide covers the complete process for signing, notarizing, and distributing Semantica on macOS.

## Prerequisites

### 1. Apple Developer Account
- **Required**: Apple Developer Program membership ($99/year)
- Sign up at: https://developer.apple.com/programs/
- **Note**: Apple Developer ID is required for distribution outside the Mac App Store

### 2. Certificates
You'll need two certificates from Apple Developer Portal:

#### Developer ID Application Certificate
- For signing the app itself
- Create at: https://developer.apple.com/account/resources/certificates/add
- Choose "Developer ID Application"

#### Developer ID Installer Certificate (optional)
- For signing .pkg installers
- Only needed if distributing via .pkg instead of .dmg

### 3. Install Certificates
1. Download certificates from Apple Developer Portal
2. Double-click to install in Keychain Access
3. Verify in Keychain Access → My Certificates
4. Should see: "Developer ID Application: Your Name (TEAM_ID)"

## Configuration

### 1. Update App ID
Edit `package.json`:
```json
"build": {
  "appId": "com.yourcompany.semantica",  // Update this!
  "productName": "Semantica",
  ...
}
```

### 2. Environment Variables
Create `.env.local` (add to .gitignore):
```bash
# Apple Developer Credentials for Code Signing and Notarization
APPLE_ID=your-apple-id@email.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=XXXXXXXXXX

# Certificate identity (from Keychain)
CSC_LINK=/path/to/certificate.p12  # Optional: export from Keychain
CSC_KEY_PASSWORD=certificate-password
```

**Getting App-Specific Password:**
1. Go to https://appleid.apple.com
2. Sign in → Security → App-Specific Passwords
3. Generate password for "Semantica"

### 3. Create Enhanced Notarization Script
Create `scripts/notarize.js` with improved error handling and progress feedback:
```javascript
const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Fail if no credentials provided (don't skip silently)
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.error('❌ Notarization failed: Apple credentials not provided');
    console.error('Required environment variables:');
    console.error('  APPLE_ID=' + (process.env.APPLE_ID ? '✓ Set' : '✗ Missing'));
    console.error('  APPLE_APP_SPECIFIC_PASSWORD=' + (process.env.APPLE_APP_SPECIFIC_PASSWORD ? '✓ Set' : '✗ Missing'));
    console.error('  APPLE_TEAM_ID=' + (process.env.APPLE_TEAM_ID ? '✓ Set' : '✗ Missing (optional but recommended)'));
    throw new Error('Apple credentials required for notarization. Set APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD in .env.local');
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log('Starting notarization process...');
  console.log('App path:', appPath);
  console.log('Apple ID:', process.env.APPLE_ID);
  console.log('Team ID:', process.env.APPLE_TEAM_ID || 'Not specified');
  console.log('Using notarytool (faster than legacy altool)');
  console.log('This process typically takes 2-5 minutes...');

  try {
    const startTime = Date.now();
    let progressInterval;
    
    // Show progress every 30 seconds
    progressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`⏳ Notarization in progress... (${elapsed}s elapsed)`);
    }, 30000);
    
    await notarize({
      appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
      tool: 'notarytool' // Use new notarytool (faster than legacy altool)
    });
    
    clearInterval(progressInterval);
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`✅ Notarization completed successfully in ${duration} seconds`);
    
  } catch (error) {
    console.error('❌ Notarization failed:', error.message);
    
    // Provide helpful error messages
    if (error.message.includes('Invalid credentials')) {
      console.error('Check your APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD');
      console.error('Make sure you are using an app-specific password, not your Apple ID password');
    } else if (error.message.includes('Team ID')) {
      console.error('Make sure APPLE_TEAM_ID matches your Developer ID certificate');
    }
    
    throw error;
  }
};
```

### 4. Automated Build with Notarization

#### Install Dependencies
```bash
# For automatic credential loading
npm install --save-dev dotenv-cli

# For notarization
npm install --save-dev @electron/notarize
```

#### Update package.json Scripts
Modify the `dist` script to automatically load credentials from `.env.local`:
```json
"scripts": {
  "build": "tsc -b && node esbuild.build.mjs && vite build",
  "dist": "npm run build && dotenv -e .env.local -- electron-builder"
}
```

**Important**: When using electron-builder with CSC_NAME, only provide the name without the "Developer ID Application:" prefix:
```bash
# .env.local
CSC_NAME=Your Name (YOUR_TEAM_ID)  # ✅ Correct
# NOT: CSC_NAME=Developer ID Application: Your Name (YOUR_TEAM_ID)  # ❌ Wrong
```

### 5. Update package.json Build Configuration
Add notarization hook:
```json
"build": {
  "appId": "com.yourcompany.semantica",
  "productName": "Semantica",
  "afterSign": "scripts/notarize.js",
  "mac": {
    "category": "public.app-category.productivity",
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist",
    "target": [
      {
        "target": "dmg",
        "arch": ["x64", "arm64"]
      },
      {
        "target": "zip",
        "arch": ["x64", "arm64"]
      }
    ]
  },
  ...
}
```

### 5. Install Dependencies
```bash
npm install --save-dev @electron/notarize
```

## Current Entitlements Analysis

The app currently has these entitlements in `build/entitlements.mac.plist`:

- ✅ `com.apple.security.cs.allow-jit` - Required for V8 JavaScript engine
- ✅ `com.apple.security.cs.allow-unsigned-executable-memory` - Required for JIT compilation
- ✅ `com.apple.security.cs.disable-library-validation` - Required for native Node modules
- ✅ `com.apple.security.files.user-selected.read-write` - Required for file system access

These are appropriate for an Electron app with native modules (LanceDB, Python sidecar).

## Build & Sign Process

### 1. Clean Build
```bash
# Clean previous builds
rm -rf dist dist-app

# Install dependencies
npm install
```

### 2. Build for Production
```bash
# Load environment variables
source .env.local

# Build and sign
npm run dist

# Or for specific architecture:
npm run dist -- --mac --x64
npm run dist -- --mac --arm64
npm run dist -- --mac --universal
```

### 3. What Happens During Build
1. **TypeScript Compilation**: Compiles all TypeScript files
2. **Bundling**: esbuild bundles Electron files, Vite bundles React
3. **Packaging**: electron-builder packages the app
4. **Signing**: macOS codesign tool signs all binaries
5. **Notarization**: Uploads to Apple for notarization
6. **Stapling**: Attaches notarization ticket to app
7. **DMG Creation**: Creates distributable disk image

### 4. Verify Signing
```bash
# Check code signature
codesign --verify --deep --strict --verbose=4 "dist-app/mac/Semantica.app"

# Check notarization
spctl -a -t exec -vvv "dist-app/mac/Semantica.app"

# Should see: "accepted" and "notarized"
```

## Distribution Options

### Option 1: Direct Distribution (Recommended)
- Distribute the `.dmg` file from `dist-app/`
- Users download and drag to Applications
- Automatic updates via electron-updater

### Option 2: Mac App Store
Requires additional configuration:
1. Change certificate type to "Mac App Store"
2. Add App Store entitlements
3. Create provisioning profile
4. Submit via App Store Connect

### Option 3: Homebrew Cask
Create a formula for homebrew-cask distribution:
```ruby
cask "finder-semantic-search" do
  version "1.0.0"
  sha256 "..."
  
  url "https://github.com/jean-bovet/Semantica/releases/download/v#{version}/Semantica-#{version}-arm64.dmg"
  
  name "Semantica"
  desc "Offline semantic search for Mac"
  homepage "https://github.com/jean-bovet/Semantica"
  
  app "Semantica.app"
end
```

## Troubleshooting

### Common Issues

1. **"Developer ID Application" not found**
   - Ensure certificate is installed in Keychain
   - Check certificate hasn't expired
   - Try: `security find-identity -v -p codesigning`

2. **Notarization fails with "Invalid credentials"**
   - Verify app-specific password
   - Check APPLE_TEAM_ID matches certificate
   - Ensure Apple ID has access to the team

3. **"The application is damaged" error**
   - Sign all native modules
   - Ensure all entitlements are correct
   - Check Gatekeeper: `xattr -cr "Semantica.app"`

4. **Notarization times out**
   - Large apps (>100MB) may take 5-30 minutes
   - Check status: `xcrun notarytool history --apple-id YOUR_APPLE_ID`

5. **Native modules not signed**
   - electron-builder should handle this automatically
   - If issues persist, may need to manually sign:
   ```bash
   codesign --force --sign "Developer ID Application: Your Name" \
     node_modules/@lancedb/lancedb/build/Release/lancedb.node
   ```

## Security Best Practices

1. **Never commit credentials**
   - Use environment variables
   - Add `.env.local` to `.gitignore`

2. **Rotate passwords regularly**
   - Regenerate app-specific passwords periodically
   - Update certificates before expiration

3. **Minimal entitlements**
   - Only request necessary permissions
   - Document why each entitlement is needed

4. **Code integrity**
   - Enable hardened runtime (already done)
   - Use secure timestamp server
   - Verify signatures before distribution

## Automated CI/CD

For GitHub Actions, create `.github/workflows/release.yml`:
```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: macos-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: 18
          
      - name: Install dependencies
        run: npm ci
        
      - name: Build and sign
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
        run: npm run dist
        
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: mac-dist
          path: dist-app/*.dmg
```

## Final Checklist

Before distribution:
- [ ] Update version in package.json
- [ ] Update CHANGELOG.md
- [ ] Test on clean macOS installation
- [ ] Verify code signing: `codesign --verify`
- [ ] Verify notarization: `spctl -a -t exec`
- [ ] Test auto-updater functionality
- [ ] Scan for sensitive data in bundle
- [ ] Create GitHub release with release notes
- [ ] Upload .dmg and .zip to release
- [ ] Update download links on website

## Summary

The app is already well-configured for signing with:
- ✅ Hardened runtime enabled
- ✅ Proper entitlements for Electron + native modules
- ✅ electron-builder configuration

Next steps:
1. Get Apple Developer account
2. Create certificates
3. Add notarization script
4. Update app ID to your organization
5. Build and distribute!