const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  // Only notarize for macOS
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Fail if no credentials provided
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