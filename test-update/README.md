# Auto-Update Testing Setup

This directory contains tools to test the auto-update functionality locally without deploying to GitHub.

## Files

- `server.js` - Mock HTTP server that serves update files
- `latest-mac.yml` - Update manifest file (simulates GitHub release metadata)
- `test-update.sh` - Automated test script
- `README.md` - This file

## How to Test Auto-Update

### Step 1: Start the Mock Update Server

In terminal 1:
```bash
cd test-update
node server.js
```

The server will run on http://localhost:8080 and serve:
- `/latest-mac.yml` - The update manifest
- `/Semantica-1.0.2.dmg` - Mock DMG file (for testing)

### Step 2: Run the Test

In terminal 2:
```bash
cd test-update
./test-update.sh
```

This script will:
1. Check that the mock server is running
2. Backup your current package.json
3. Change version to 1.0.1 (to simulate old version)
4. Build the app with version 1.0.1
5. Run the app with UPDATE_URL pointing to localhost:8080
6. Restore original package.json when done

### Step 3: Observe the Update Process

1. The app should start and show version 1.0.1
2. After 5 seconds, it will check for updates
3. It should detect version 1.0.2 is available
4. You can also manually check via: **Semantica menu → Check for Updates...**
5. Check logs at: `~/Library/Logs/Semantica/main.log`

## Manual Testing

You can also test manually:

```bash
# Terminal 1: Start server
cd test-update
node server.js

# Terminal 2: Run app with custom update URL
UPDATE_URL=http://localhost:8080 npm run dev
```

Then use the menu: **Semantica → Check for Updates...**

## Troubleshooting

### Update not detected?
- Check the logs: `tail -f ~/Library/Logs/Semantica/main.log`
- Ensure version in package.json is lower than version in latest-mac.yml
- Verify server is running: `curl http://localhost:8080/latest-mac.yml`

### Connection timeout?
- Make sure the mock server is running
- Check if port 8080 is available: `lsof -i :8080`
- Try a different port in server.js if needed

### Testing Real GitHub Updates
To test against real GitHub releases:
1. Don't set UPDATE_URL environment variable
2. Ensure your GitHub repository has releases with attached DMG files
3. The app will check: `https://github.com/jean-bovet/Semantica/releases`

## Notes

- The mock DMG file is just a text file for testing
- Real updates would download actual DMG files from GitHub
- The sha512 hashes in latest-mac.yml are fake for testing
- In production, electron-builder generates these files automatically