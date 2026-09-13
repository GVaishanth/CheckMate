/**
 * Post-build step: sanity-check that the static deploy is complete.
 * (Routing is hash-based, so no 404.html SPA fallback is required — every
 * shareable URL is /#/route and always resolves to the site root.)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const dist = join(process.cwd(), 'dist');
const index = join(dist, 'index.html');
const missing = [];

for (const f of ['index.html', 'favicon.svg', 'manifest.webmanifest', 'sw.js']) {
  if (!existsSync(join(dist, f))) missing.push(f);
}

if (missing.length > 0) {
  console.error(`postbuild: missing files in dist/: ${missing.join(', ')}`);
  process.exit(1);
}

// Stamp the service-worker cache with a hash of the built document so every
// deploy installs a fresh SW and purges stale hashed assets on activate.
const html = readFileSync(index, 'utf8');
const swPath = join(dist, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
const stamp = createHash('sha256').update(html).digest('hex').slice(0, 10);
writeFileSync(swPath, sw.replace('checkmate-v1', `checkmate-${stamp}`));

// Report bundle facts (honest numbers for the build log).
const assets = (html.match(/assets\/[a-zA-Z0-9._-]+\.js/g) ?? []).length;
console.log(`postbuild: ${assets} entry chunk(s) referenced; static assets verified.`);
