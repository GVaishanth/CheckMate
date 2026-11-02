/** Rebuilds the bundled social card; requires optional @playwright/test and Chromium. */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(root, 'scripts/og/og.html')).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(root, 'public/og.png') });
} finally {
  await browser.close();
}
