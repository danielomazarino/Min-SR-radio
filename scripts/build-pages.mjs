import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeLineEndings } from './normalize-line-endings.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const assets = ['app.js', 'styles.css', 'sw.js', 'index.html', 'manifest.webmanifest'];

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8);
}
function copyFile(relativePath) {
  const source = path.join(root, relativePath);
  const target = path.join(dist, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

// Validate each entry asset and discover local module dependencies recursively.
for (const file of assets) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing Pages source asset: ${file}`);
}
for (const file of ['tests/fixpass.test.mjs', 'tests/episode-seek.test.mjs', 'tests/duration-format.test.mjs']) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing tracked regression test: ${file}`);
}
const moduleFiles = new Set(['app.js']);
const importRe = /(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.\.?\/[^'"]+)['"]/g;
const visitImports = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const match of source.matchAll(importRe)) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
    if (!resolved.endsWith('.mjs') && !resolved.endsWith('.js')) continue;
    if (moduleFiles.has(resolved)) continue;
    if (!fs.existsSync(path.join(root, resolved))) throw new Error(`Missing module dependency: ${resolved}`);
    moduleFiles.add(resolved);
    visitImports(resolved);
  }
};
visitImports('app.js');

// GitHub Pages root is the deploy target; build will overwrite generated bundles,
// the service-worker shell and index. Keep authoring files outside this output.
for (const module of moduleFiles) {
  const output = path.resolve(root, module);
  if (!output.startsWith(`${root}${path.sep}`)) throw new Error(`Module path escapes repository: ${module}`);
}

fs.rmSync(dist, { recursive: true, force: true });
for (const file of ['index.html', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest']) copyFile(file);
for (const file of ['app.js', 'styles.css']) {
  const target = path.join(dist, file);
  const text = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, normalizeLineEndings(text));
}
for (const icon of ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png']) {
  const source = path.join(root, 'icons', icon);
  if (!fs.existsSync(source)) throw new Error(`Missing PWA icon: icons/${icon}`);
  copyFile(path.posix.join('icons', icon));
}
for (const module of moduleFiles) if (module !== 'app.js') copyFile(module);

const hashed = new Map();

// ---- WS10: inject the build identity into dist/app.js, BEFORE hashing ----
// Ordering matters: the content hash below is computed over dist/app.js, so the
// injection has to happen first. That is safe because the id is the SHORT GIT
// SHA, which is external to the bundle's own bytes -- injecting it cannot
// change which commit we are on, so there is no circularity.
//
// It must NOT be the content hash of app.js: injecting that would change the
// content, which would change the hash, which would change the id, forever.
//
// ---- WHY THIS IS NOT `HEAD` (WS10 follow-up, owner-visible defect) ----
// A first version used `HEAD`. That is wrong, and it was wrong in a way the
// owner would have hit immediately: the tracked bundle lives IN the repository,
// so the commit that stores the bundle cannot be the id inside it. The build
// runs before the artifact commit exists, so the screen showed the PARENT's
// SHA -- an id that resolves to a real commit but never to the one the owner
// is looking at. Observed exactly: bundle `app.c4d7f88e.js` carried
// `0e6e89b0` while HEAD was `16fa6ba`.
//
// The id must therefore name the commit whose SOURCE produced this bundle,
// which is the last commit that touched app.js. That commit exists before the
// build runs, it is exactly what an owner can `git log` to, and it is stable
// across rebuilds of an unchanged tree. Artifact-only commits (which touch no
// source) do not move it, so re-committing a rebuilt bundle does not
// invalidate the id on screen.
//
// The repo-root app.js keeps the `__APP_BUILD_ID__` placeholder; only the
// generated dist/app.js (which is what Pages serves) gets the real value.
function resolveBuildId() {
  try {
    // The last commit that touched the authored source, not HEAD. Falls back to
    // HEAD only when the file has no history at all (fresh repo).
    let sha = execFileSync('git', [
      'log', '-1', '--format=%h', '--', 'app.js',
    ], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!/^[0-9a-f]{7,40}$/.test(sha)) {
      sha = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    }
    // A 7-40 char hex SHA is a real id. Anything else means git answered with
    // something unexpected (a shallow/empty repo, a tarball), so fall back
    // rather than print a plausible-looking lie.
    if (/^[0-9a-f]{7,40}$/.test(sha)) return { id: sha, source: 'git (app.js)' };
    return { id: `t${Date.now().toString(36)}`, source: 'timestamp (git gave no SHA)' };
  } catch {
    // No git at all, or not a repository. A timestamp keeps the build working
    // and -- crucially -- says so in the output, so a fallback is never
    // mistaken for a real commit id.
    return { id: `t${Date.now().toString(36)}`, source: 'timestamp (git unavailable)' };
  }
}
const build = resolveBuildId();
const BUILD_PLACEHOLDER = '__APP_BUILD_ID__';
{
  const distApp = path.join(dist, 'app.js');
  let source = fs.readFileSync(distApp, 'utf8');
  const declaration = /const APP_BUILD = '[^']*';/g;
  const declarations = source.match(declaration) || [];
  if (declarations.length !== 1) {
    throw new Error(`app.js must declare APP_BUILD exactly once (found ${declarations.length})`);
  }
  // Two idempotent paths, and the order matters:
  //   1. already injected (placeholder gone) -> overwrite the existing value
  //   2. still the authoring placeholder       -> substitute it
  // A second build therefore produces identical bytes and can never append a
  // second declaration.
  if (source.includes(BUILD_PLACEHOLDER)) {
    source = source.replaceAll(BUILD_PLACEHOLDER, build.id);
  } else {
    source = source.replace(declaration, `const APP_BUILD = '${build.id}';`);
  }
  const injected = /const APP_BUILD = '([^']*)';/.exec(source);
  if (!injected || injected[1] !== build.id) {
    throw new Error(`build id injection failed (wanted ${build.id})`);
  }
  fs.writeFileSync(distApp, source);
}

for (const asset of ['app.js', 'styles.css']) {
  const bytes = fs.readFileSync(path.join(dist, asset));
  const output = asset.replace('.', `.${hash(bytes)}.`);
  fs.writeFileSync(path.join(dist, output), bytes);
  hashed.set(asset, output);
}

let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
html = html.replace(/href="styles(?:\.[a-f0-9]{8})?\.css"/, `href="${hashed.get('styles.css')}"`)
  .replace(/src="app(?:\.[a-f0-9]{8})?\.js"/, `src="${hashed.get('app.js')}"`);
fs.writeFileSync(path.join(dist, 'index.html'), html);

let sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
sw = sw.replace(/'\.\/app(?:\.[a-f0-9]{8})?\.js'/, `'./${hashed.get('app.js')}'`)
  .replace(/'\.\/styles(?:\.[a-f0-9]{8})?\.css'/, `'./${hashed.get('styles.css')}'`);
const moduleAssets = [...moduleFiles].filter((file) => file !== 'app.js');
const shellMatch = /const SHELL_ASSETS = \[([\s\S]*?)\];/.exec(sw);
if (!shellMatch) throw new Error('Service-worker shell asset list missing');
const shellEntries = [...new Set([
  ...[...shellMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
  ...moduleAssets.map((file) => `./${file}`),
])];
sw = sw.replace(shellMatch[0], `const SHELL_ASSETS = [\n${shellEntries.map((file) => `  '${file}',`).join('\n')}\n];`);
const moduleFingerprints = moduleAssets.map((file) => {
  const bytes = fs.readFileSync(path.join(root, file));
  return `${file}:${hash(bytes)}`;
});
const hashedAssetFingerprints = [...hashed.values()].map((file) => {
  const bytes = fs.readFileSync(path.join(dist, file));
  return `${file}:${hash(bytes)}`;
});
const cacheFingerprint = [...hashedAssetFingerprints, ...moduleFingerprints].join(':');
sw = sw.replace(/const CACHE_NAME = '.*';/, `const CACHE_NAME = 'minradio-${hash(Buffer.from(cacheFingerprint))}';`);
fs.writeFileSync(path.join(dist, 'sw.js'), sw);

for (const file of ['index.html', 'sw.js', 'manifest.webmanifest']) {
  const contents = fs.readFileSync(path.join(dist, file), 'utf8');
  const refs = file === 'index.html'
    ? [...contents.matchAll(/(?:src|href)="([^"#]+)"/g)].map((match) => match[1])
    : file === 'manifest.webmanifest'
      ? [...contents.matchAll(/"src"\s*:\s*"([^"]+)"/g)].map((match) => match[1])
      : [...contents.matchAll(/'\.\/([^']+)'/g)].map((match) => match[1]);
  for (const ref of refs) {
    const target = path.resolve(dist, ref);
    if (!target.startsWith(`${dist}${path.sep}`) || !fs.existsSync(target)) {
      throw new Error(`Built shell references missing asset ${ref} from ${file}`);
    }
  }
}

// GitHub Pages publishes the repository root (branch settings verified).
// Keep authored app.js/styles.css as readable sources, but atomically refresh
// the root HTML, hashed runtime assets, module dependencies, and service worker
// from this one build so a successful build is the artifact Pages will serve.
for (const file of ['index.html', 'sw.js', hashed.get('app.js'), hashed.get('styles.css')]) {
  fs.copyFileSync(path.join(dist, file), path.join(root, file));
}
for (const file of fs.readdirSync(root)) {
  if (/^app\.[a-f0-9]{8}\.js$/.test(file) && file !== hashed.get('app.js')) fs.rmSync(path.join(root, file));
  if (/^styles\.[a-f0-9]{8}\.css$/.test(file) && file !== hashed.get('styles.css')) fs.rmSync(path.join(root, file));
}
for (const module of moduleAssets) {
  const target = path.join(root, module);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(dist, module), target);
}

console.log(`GitHub Pages artifact built from tracked root assets → ${dist}`);
console.log(`Build id: ${build.id}  (source: ${build.source})`);
console.log(`HTML JS: ${hashed.get('app.js')}`);
console.log(`HTML CSS: ${hashed.get('styles.css')}`);
console.log(`Module assets precached: ${moduleAssets.join(', ') || '(none)'}`);
console.log(`Service worker cache: ${sw.match(/const CACHE_NAME = '([^']+)'/)[1]}`);
console.log('Published candidate assets synced to repository root for GitHub Pages.');
