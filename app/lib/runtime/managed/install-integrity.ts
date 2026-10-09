/*
 * Runs in the browser sandbox, reads package metadata only, and never imports
 * dependency code. npm can exit successfully after an interrupted extraction
 * while leaving empty package directories; that is not a source-code error.
 */
export const installIntegrityScript = `
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
const root = process.cwd();
const modules = resolve(root, 'node_modules');
const failures = new Set();
const safe = (path) => typeof path === 'string' && path.startsWith('node_modules/') &&
  !path.includes('\\\\') && !path.split('/').some(p => !p || p === '.' || p === '..') &&
  !/[\\x00-\\x1f]/.test(path);
const packages = new Set();
try {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const path = 'node_modules/' + name;
    if (!safe(path)) throw new Error();
    packages.add(path);
  }
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  // Optional platform packages can legitimately be absent. Still inspect any
  // package npm actually created, including empty transitive @types folders.
  for (const [path, entry] of Object.entries(lock.packages || {})) {
    if (!path || entry.link || !safe(path)) continue;
    try { if ((await stat(path)).isDirectory()) packages.add(path); } catch {}
  }
  try {
    for (const entry of await readdir('node_modules/@types', { withFileTypes: true }))
      if (entry.isDirectory()) packages.add('node_modules/@types/' + entry.name);
  } catch {}
  for (const path of packages) {
    if (!safe(path)) throw new Error();
    try {
      const metadata = JSON.parse(await readFile(path + '/package.json', 'utf8'));
      if (!metadata.name || !metadata.version) throw new Error();
      const types = metadata.types || metadata.typings;
      if (types) {
        const target = resolve(path, types);
        // Do not inspect arbitrary absolute paths from package metadata.
        if (!target.startsWith(modules + sep)) throw new Error();
        // TypeScript also accepts extensionless declarations (for example
        // ts-interface-checker's "typings": "dist/index") and directory entries.
        // Check these documented file shapes without loading dependency code.
        let found = false;
        for (const entry of [target, target + '.d.ts', resolve(target, 'index.d.ts')]) {
          try {
            const info = await stat(entry);
            if (info.isFile() && info.size > 0 && (await readFile(entry, 'utf8')).trim()) { found = true; break; }
          } catch {}
        }
        if (!found) throw new Error();
      }
      // The icon package has separate declaration/runtime entries for each
      // family. A healthy root declaration says nothing about react-icons/fa.
      // Validate its explicit shipped files without evaluating package code.
      if (metadata.name === 'react-icons') {
        const packageRoot = resolve(path);
        for (const target of Object.values(metadata.exports || {})) {
          if (!target || typeof target !== 'object') continue;
          for (const key of ['types', 'import', 'require']) {
            const file = target[key];
            if (typeof file !== 'string' || file.includes('*')) continue;
            if (!file.startsWith('./') || file.includes('\\\\') || file.split('/').includes('..')) throw new Error();
            const entry = resolve(path, file);
            if (!entry.startsWith(packageRoot + sep)) throw new Error();
            const info = await stat(entry);
            if (!info.isFile() || info.size === 0 || !(await readFile(entry, 'utf8')).trim()) throw new Error();
          }
        }
      }
    } catch { failures.add(path); }
  }
} catch { failures.add('package-metadata'); }
if (failures.size) {
  console.error('JINGYUE_INSTALL_INCOMPLETE: ' + [...failures].slice(0, 12).join(', '));
  process.exitCode = 86;
}
`;
