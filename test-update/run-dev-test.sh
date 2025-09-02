#!/bin/bash

# Test auto-update locally with mock server

echo "╔════════════════════════════════════════════════════════╗"
echo "║  Semantica Auto-Update Local Test                       ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "Prerequisites:"
echo "  1. Start mock server: cd test-update && node server.js"
echo "  2. Ensure package.json version is 1.0.1 (for testing)"
echo ""
echo "Once running:"
echo "  • Menu: Semantica → Check for Updates..."
echo "  • Logs: ~/Library/Logs/Semantica/main.log"
echo ""

# Run with custom update URL pointing to mock server
cd ..
UPDATE_URL=http://localhost:8080 npm run dev