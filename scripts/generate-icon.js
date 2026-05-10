const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const size = 512;

// Create build directory if it doesn't exist
const buildDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
    <linearGradient id="cup" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#e94560"/>
      <stop offset="100%" style="stop-color:#ff6b6b"/>
    </linearGradient>
    <linearGradient id="steam" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" style="stop-color:#e94560;stop-opacity:0.8"/>
      <stop offset="100%" style="stop-color:#ff6b6b;stop-opacity:0"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0f3460"/>
      <stop offset="100%" style="stop-color:#533483"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <!-- Background rounded square -->
  <rect width="${size}" height="${size}" rx="80" fill="url(#bg)"/>
  <!-- Coffee cup body -->
  <path d="M140,180 L140,340 Q140,380 180,380 L340,380 Q380,380 380,340 L380,180 Z" fill="url(#cup)" filter="url(#glow)"/>
  <!-- Cup handle -->
  <path d="M380,220 Q440,220 440,280 Q440,340 380,340" stroke="url(#cup)" stroke-width="16" fill="none" stroke-linecap="round"/>
  <!-- Saucer -->
  <ellipse cx="260" cy="400" rx="140" ry="20" fill="url(#accent)" opacity="0.6"/>
  <!-- Steam waves -->
  <path d="M200,160 Q210,120 200,80" stroke="url(#steam)" stroke-width="8" fill="none" stroke-linecap="round"/>
  <path d="M260,160 Q270,100 260,50" stroke="url(#steam)" stroke-width="10" fill="none" stroke-linecap="round"/>
  <path d="M320,160 Q330,120 320,80" stroke="url(#steam)" stroke-width="8" fill="none" stroke-linecap="round"/>
  <!-- Creative spark / star -->
  <g transform="translate(300,100) scale(0.6)" filter="url(#glow)">
    <path d="M0,-40 L8,-12 L40,-8 L8,4 L0,40 L-8,4 L-40,-8 L-8,-12 Z" fill="#ffd700"/>
  </g>
  <!-- Coffee surface -->
  <ellipse cx="260" cy="185" rx="115" ry="15" fill="#5c1a0a" opacity="0.8"/>
</svg>`;

const buffer = Buffer.from(svg);
const sizes = [512, 256, 128, 64, 48, 32, 16];

async function generateIcons() {
  for (const s of sizes) {
    await sharp(buffer)
      .resize(s, s)
      .png()
      .toFile(path.join(buildDir, `icon-${s}.png`));
    console.log(`Created ${s}x${s} icon`);
  }
  // Also create icon.png (512x512 default for electron-builder)
  fs.copyFileSync(path.join(buildDir, 'icon-512.png'), path.join(buildDir, 'icon.png'));
  console.log('Created icon.png (512x512)');
  console.log('All icons created successfully!');
}

generateIcons().catch(err => console.error('Error:', err));
