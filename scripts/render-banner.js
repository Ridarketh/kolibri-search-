#!/usr/bin/env node
// Renders docs/banner.html into docs/banner.png (README) and docs/social-preview.png (GitHub, 1280x640).
// Run `SHOTS=1 npm run test:e2e` first so docs/screenshots/card-*.png exist.
'use strict';

const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const docs = path.join(__dirname, '..', 'docs');
  const browser = await chromium.launch();
  for (const [file, scale] of [['banner.png', 1.5], ['social-preview.png', 1]]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: scale });
    await page.goto('file://' + path.join(docs, 'banner.html'));
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(docs, file) });
    await page.close();
    console.log('docs/' + file);
  }
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
