// Verifies bundled font assets exist after install (informational only).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'src', 'assets', 'fonts');
const fonts = ['inter-400.woff2', 'inter-500.woff2', 'inter-600.woff2', 'grotesk-500.woff2', 'grotesk-700.woff2', 'mono-400.woff2', 'mono-600.woff2'];
const missing = fonts.filter((f) => !existsSync(join(dir, f)));
if (missing.length > 0) {
  console.log('[fonts] not yet present (they are committed in src/assets/fonts):', missing.join(', '));
}
