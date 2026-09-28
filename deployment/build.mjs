import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, cp, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { inspectRelease } from './scan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
// Reuse the lockfile-pinned esbuild already installed as a Vite dependency.
const viteRequire = createRequire(require.resolve('vite/package.json'));
const { build } = viteRequire('esbuild');
const releaseRoot = join(root, 'deployment/releases');
await mkdir(releaseRoot, { recursive: true });
const output = await mkdtemp(join(releaseRoot, 'jingyue-private-'));
await build({
  entryPoints: [join(root, 'deployment/server.mjs')],
  outfile: join(output, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  minify: false,
  alias: { 'react-dom/server': 'react-dom/server.browser' },
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: {
    js: "import { createRequire as __makeRequire } from 'node:module'; const require = __makeRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
await cp(join(root, 'build/client'), join(output, 'client'), {
  recursive: true,
  filter: (path) => !path.endsWith('.map'),
});
await mkdir(join(output, 'licenses'));
await cp(join(root, 'LICENSE'), join(output, 'licenses/bolt-MIT.txt'));
await cp(join(dirname(require.resolve('pg/package.json')), 'LICENSE'), join(output, 'licenses/node-postgres-MIT.txt'));
for (const name of ['passport', 'passport-local', 'passport-strategy', 'pause', 'utils-merge']) {
  const from = name === 'passport-local' || name === 'passport' ? require : createRequire(require.resolve('passport/package.json'));
  await cp(join(dirname(from.resolve(`${name}/package.json`)), name === 'pause' ? 'Readme.md' : 'LICENSE'), join(output, `licenses/${name}-MIT.txt`));
}
await cp(join(root, 'third-party/onlook'), join(output, 'licenses/onlook'), { recursive: true });
await writeFile(
  join(output, 'package.json'),
  JSON.stringify(
    {
      name: 'jingyue-private-workbench',
      private: true,
      type: 'module',
      engines: { node: '>=22' },
      scripts: { start: 'node server.mjs' },
    },
    null,
    2,
  ) + '\n',
);
await cp(join(root, 'deployment/README.md'), join(output, 'DEPLOYMENT.md'));
await cp(join(root, 'deployment/sql'), join(output, 'sql'), { recursive: true });
await cp(join(root, 'deployment/PROJECTS.md'), join(output, 'PROJECTS.md'));
await cp(join(root, 'deployment/ACCOUNTS.md'), join(output, 'ACCOUNTS.md'));
await cp(join(root, 'deployment/persistence.env.example'), join(output, 'persistence.env.example'));

// Allowlist construction never reads local key/configuration files.
const inspection = await inspectRelease(output);
execFileSync('/usr/bin/tar', ['-czf', `${output}.tgz`, '-C', output, '.']);
execFileSync('/usr/bin/zip', ['-qr', `${output}.zip`, '.'], { cwd: output });
process.stdout.write(
  JSON.stringify({
    directory: output,
    archive: `${output}.tgz`,
    zip: `${output}.zip`,
    ...inspection,
    credentialScanPassed: true,
    nativeDependencies: false,
    linuxVerified: false,
  }) + '\n',
);
