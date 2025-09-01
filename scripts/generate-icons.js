#!/usr/bin/env node

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const svgPath = process.argv[2] || path.join(__dirname, '../build/icon.svg');
const buildDir = path.join(__dirname, '../build');

// Ensure build directory exists
if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
}

// Icon sizes needed for different platforms
const sizes = [16, 32, 64, 128, 256, 512, 1024];

async function generatePNGs() {
    console.log('Generating PNG icons...');
    
    // Read the SVG file
    const svgBuffer = fs.readFileSync(svgPath);
    
    for (const size of sizes) {
        const outputPath = path.join(buildDir, `icon_${size}x${size}.png`);
        
        await sharp(svgBuffer)
            .resize(size, size)
            .png()
            .toFile(outputPath);
        
        console.log(`  ✓ Generated ${size}x${size} PNG`);
    }
    
    // Also create the main icon.png (512x512 for electron-builder)
    await sharp(svgBuffer)
        .resize(512, 512)
        .png()
        .toFile(path.join(buildDir, 'icon.png'));
    
    console.log('  ✓ Generated main icon.png (512x512)');
}

async function generateICNS() {
    console.log('Generating macOS ICNS file...');
    
    // Create iconset directory
    const iconsetPath = path.join(buildDir, 'icon.iconset');
    if (!fs.existsSync(iconsetPath)) {
        fs.mkdirSync(iconsetPath);
    }
    
    // macOS iconset requires specific sizes and naming
    const icnsConfig = [
        { size: 16, name: 'icon_16x16.png' },
        { size: 32, name: 'icon_16x16@2x.png' },
        { size: 32, name: 'icon_32x32.png' },
        { size: 64, name: 'icon_32x32@2x.png' },
        { size: 128, name: 'icon_128x128.png' },
        { size: 256, name: 'icon_128x128@2x.png' },
        { size: 256, name: 'icon_256x256.png' },
        { size: 512, name: 'icon_256x256@2x.png' },
        { size: 512, name: 'icon_512x512.png' },
        { size: 1024, name: 'icon_512x512@2x.png' },
    ];
    
    const svgBuffer = fs.readFileSync(svgPath);
    
    for (const config of icnsConfig) {
        const outputPath = path.join(iconsetPath, config.name);
        await sharp(svgBuffer)
            .resize(config.size, config.size)
            .png()
            .toFile(outputPath);
    }
    
    // Use iconutil to create the ICNS file
    try {
        await execAsync(`iconutil -c icns -o "${path.join(buildDir, 'icon.icns')}" "${iconsetPath}"`);
        console.log('  ✓ Generated icon.icns');
        
        // Clean up iconset directory
        await execAsync(`rm -rf "${iconsetPath}"`);
    } catch (error) {
        console.error('  ✗ Failed to generate ICNS (iconutil required on macOS):', error.message);
    }
}

async function generateICO() {
    console.log('Generating Windows ICO file...');
    
    // For ICO, we'll use the PNG files we generated
    // Note: This requires png2ico or similar tool, or we can use sharp-ico plugin
    // For now, we'll just copy the 256x256 PNG as a fallback
    const source = path.join(buildDir, 'icon_256x256.png');
    const dest = path.join(buildDir, 'icon.ico');
    
    // Try to use png2ico if available
    try {
        const pngFiles = [16, 32, 48, 64, 128, 256].map(size => 
            path.join(buildDir, `icon_${size}x${size}.png`)
        ).join(' ');
        
        await execAsync(`png2ico "${dest}" ${pngFiles}`);
        console.log('  ✓ Generated icon.ico with png2ico');
    } catch (error) {
        // Fallback: just copy the PNG
        fs.copyFileSync(source, dest);
        console.log('  ✓ Generated icon.ico (fallback: copied 256x256 PNG)');
    }
}

async function main() {
    try {
        console.log(`Using SVG: ${svgPath}`);
        
        // Check if sharp is installed
        try {
            require.resolve('sharp');
        } catch (e) {
            console.log('Installing sharp...');
            await execAsync('npm install sharp');
        }
        
        await generatePNGs();
        
        if (process.platform === 'darwin') {
            await generateICNS();
        }
        
        await generateICO();
        
        console.log('\n✅ Icon generation complete!');
        console.log(`Icons saved to: ${buildDir}`);
    } catch (error) {
        console.error('❌ Error generating icons:', error);
        process.exit(1);
    }
}

main();