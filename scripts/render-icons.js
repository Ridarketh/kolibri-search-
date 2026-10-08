#!/usr/bin/env node
// Renders extension/icons/icon.svg into the PNG sizes Chrome needs.
// Usage: npm run icons   (needs the `sharp` dev dependency)
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const src = path.join(root, 'extension/icons/icon.svg');
const sizes = [16, 32, 48, 128];

(async () => {
  const svg = fs.readFileSync(src);
  for (const size of sizes) {
    const out = path.join(root, `extension/icons/icon-${size}.png`);
    await sharp(svg, { density: 512 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
    console.log('icon', size, '->', path.relative(root, out));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
