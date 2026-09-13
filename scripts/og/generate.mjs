/**
 * Regenerates public/og.png (1200x630 social card) from scripts/og/og.html
 * using the project's self-hosted fonts. Run: npx playwright install chromium
 * (once), then `node scripts/og/generate.mjs`. Requires @playwright/test.
 */
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve('scripts/og/og.html')).href);
await page.waitForTimeout(600); // fonts
await page.screenshot({ path: 'public/og.png' });
// Programmatic verification (no vision): check computed font + element boxes.
const checks = await page.evaluate(() => ({
  font: getComputedStyle(document.querySelector('h1')).fontFamily,
  h1box: document.querySelector('h1').getBoundingClientRect().toJSON(),
  chips: document.querySelectorAll('.chip').length,
  body: [document.body.getBoundingClientRect().width, document.body.getBoundingClientRect().height],
  knightBox: document.querySelector('.knight').getBoundingClientRect().toJSON(),
}));
console.log(JSON.stringify(checks, null, 1));
await browser.close();
