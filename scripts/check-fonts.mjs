import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'src', 'assets', 'fonts');
const fonts = ['inter-var.woff2', 'grotesk-var.woff2', 'mono-var.woff2'];
const missing = fonts.filter((file) => !existsSync(join(dir, file)));
if (missing.length > 0) {
  console.error('[fonts] Missing bundled assets:', missing.join(', '));
  process.exitCode = 1;
}
