import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd(), dist = join(root, 'dist');
const notices = ['inter.txt', 'space-grotesk.txt', 'jetbrains-mono.txt', 'opening-data.txt', 'third-party.txt'];
for (const file of ['index.html', 'favicon.svg', 'og.png', 'manifest.webmanifest', 'sw.js', ...notices.map((name) => `licenses/${name}`)]) {
  if (!existsSync(join(dist, file))) throw new Error(`Missing deployment file: ${file}`);
}
mkdirSync(join(dist, 'licenses'), { recursive: true });
writeFileSync(join(dist, 'licenses/project.txt'), readFileSync(join(root, 'LICENSE')));
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const files = walk(dist).map((file) => relative(dist, file).replaceAll('\\', '/')).filter((file) => file !== 'sw.js').sort();
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const verify = (base, target) => {
  if (/^(?:data:|#)/.test(target)) return;
  if (/^(?:[a-z]+:|\/\/|\/)/i.test(target)) throw new Error(`Non-relative deployment asset: ${target}`);
  const file = resolve(base, decodeURIComponent(target.split(/[?#]/)[0]));
  if (!file.startsWith(`${dist}/`) || !existsSync(file)) throw new Error(`Unresolved deployment asset: ${target}`);
};
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) verify(dist, match[1]);
for (const file of files.filter((name) => name.endsWith('.css'))) {
  for (const match of readFileSync(join(dist, file), 'utf8').matchAll(/url\(\s*['"]?([^\s)'";]+)['"]?\s*\)/g)) verify(dirname(join(dist, file)), match[1]);
}
const fonts = files.filter((file) => file.endsWith('.woff2'));
if (fonts.length !== 3 || fonts.some((file) => readFileSync(join(dist, file)).subarray(0, 4).toString() !== 'wOF2')) throw new Error('The three bundled fonts were not emitted correctly.');
if (!html.includes('Content-Security-Policy')) throw new Error('Production security policy missing.');
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
if (manifest.start_url !== './' || manifest.scope !== './') throw new Error('Manifest is not subpath-safe.');
for (const icon of manifest.icons ?? []) verify(dist, icon.src);
const sw = readFileSync(join(root, 'public/sw.js'), 'utf8');
if (!sw.includes("const BUILD = 'source';") || !/const SHELL = \[[^;]*\];/.test(sw)) throw new Error('Service worker build markers missing.');
const hash = createHash('sha256').update(sw);
for (const file of files) hash.update(`${file}\0`).update(readFileSync(join(dist, file))).update('\0');
const version = hash.digest('hex').slice(0, 16);
const shell = ['./', ...files.map((file) => `./${file}`)];
writeFileSync(join(dist, 'sw.js'), sw.replace("const BUILD = 'source';", `const BUILD = '${version}';`).replace(/const SHELL = \[[^;]*\];/, `const SHELL = ${JSON.stringify(shell)};`));
console.log(`postbuild: ${files.length + 1} deployment files verified; ${notices.length + 1} licences bundled; offline build ${version}.`);
