import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { installIntegrityScript } from './install-integrity';

const execute = (command: string, args: string[], options: { cwd: string }) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
const directories: string[] = [];

async function fixture(files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'jingyue-install-integrity-'));
  directories.push(directory);

  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content);
  }

  return directory;
}

const complete = {
  'package.json': JSON.stringify({ dependencies: { example: '1.0.0' } }),
  'package-lock.json': JSON.stringify({
    packages: {
      'node_modules/example': {},
      'node_modules/@types/prop-types': {},
      'node_modules/optional-platform-package': { optional: true },
    },
  }),
  'node_modules/example/package.json': JSON.stringify({ name: 'example', version: '1.0.0' }),
  'node_modules/@types/prop-types/package.json': JSON.stringify({
    name: '@types/prop-types',
    version: '15.7.15',
    types: 'index.d.ts',
  }),
  'node_modules/@types/prop-types/index.d.ts': 'export type Validator = unknown;',
};
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});
describe('installed dependency integrity', () => {
  it('accepts the real installed pinned icon package without executing its modules', async () => {
    const cwd = await fixture({
      'package.json': JSON.stringify({ dependencies: { 'react-icons': '5.5.0' } }),
      'package-lock.json': JSON.stringify({ packages: { 'node_modules/react-icons': {} } }),
    });
    await mkdir(join(cwd, 'node_modules'));
    await symlink(join(process.cwd(), 'node_modules/react-icons'), join(cwd, 'node_modules/react-icons'));
    await expect(
      execute(process.execPath, ['--input-type=module', '-e', installIntegrityScript], { cwd }),
    ).resolves.toMatchObject({ stdout: '', stderr: '' });
  });
  it.each(['', ' \n\t'])('rejects an empty declared type file (%j)', async (content) => {
    const cwd = await fixture({ ...complete, 'node_modules/@types/prop-types/index.d.ts': content });
    await expect(
      execute(process.execPath, ['--input-type=module', '-e', installIntegrityScript], { cwd }),
    ).rejects.toMatchObject({ code: 86 });
  });
  it.each(['types', 'import', 'require'])(
    'checks the actual icon subpath %s entry, not only package root',
    async (broken) => {
      const paths = { types: 'index.d.ts', import: 'index.mjs', require: 'index.js' };
      const files = {
        ...complete,
        'package.json': JSON.stringify({ dependencies: { 'react-icons': '5.5.0' } }),
        'node_modules/react-icons/package.json': JSON.stringify({
          name: 'react-icons',
          version: '5.5.0',
          types: 'lib/index.d.ts',
          exports: { './fa': Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, './fa/' + path])) },
        }),
        'node_modules/react-icons/lib/index.d.ts': 'export type IconType = unknown;',
        'node_modules/react-icons/fa/index.d.ts': 'export declare const FaBullseye: unknown;',
        'node_modules/react-icons/fa/index.mjs': 'throw new Error("must not execute dependencies")',
        'node_modules/react-icons/fa/index.js': 'throw new Error("must not execute dependencies")',
      };
      const cwd = await fixture(files);
      await expect(
        execute(process.execPath, ['--input-type=module', '-e', installIntegrityScript], { cwd }),
      ).resolves.toMatchObject({ stdout: '', stderr: '' });
      await writeFile(join(cwd, 'node_modules/react-icons/fa/' + paths[broken as keyof typeof paths]), '');
      await expect(
        execute(process.execPath, ['--input-type=module', '-e', installIntegrityScript], { cwd }),
      ).rejects.toMatchObject({ code: 86, stderr: expect.stringContaining('node_modules/react-icons') });
    },
  );
  it('accepts complete metadata and types while allowing absent optional platform packages', async () => {
    const cwd = await fixture(complete);
    await expect(
      execute(process.execPath, ['--input-type=module', '-e', installIntegrityScript], { cwd }),
    ).resolves.toMatchObject({ stdout: '', stderr: '' });
  });
  it('rejects the observed empty transitive type package without importing dependency code', async () => {
    const files = Object.fromEntries(Object.entries(complete).filter(([path]) => !path.includes('@types/prop-types/')));
    const cwd = await fixture(files);
    await mkdir(join(cwd, 'node_modules/@types/prop-types'), { recursive: true });
    await expect(
      execute(process.execPath, ['--input-type=module', '-e', installIntegrityScript], { cwd }),
    ).rejects.toMatchObject({ code: 86, stderr: expect.stringContaining('node_modules/@types/prop-types') });
  });
  it('rejects a declared missing type entry even if package.json exists', async () => {
    const cwd = await fixture(
      Object.fromEntries(Object.entries(complete).filter(([path]) => !path.endsWith('index.d.ts'))),
    );
    await expect(
      execute(process.execPath, ['--input-type=module', '-e', installIntegrityScript], { cwd }),
    ).rejects.toMatchObject({ code: 86 });
  });
  it.each(['dist/index', 'dist'])(
    'accepts the existing declaration entry %s without a literal extension',
    async (types) => {
      const cwd = await fixture({
        ...complete,
        'node_modules/example/package.json': JSON.stringify({ name: 'example', version: '1.0.0', typings: types }),
        'node_modules/example/dist/index.d.ts': 'export type Example = string;',
      });
      await expect(
        execute(process.execPath, ['--input-type=module', '-e', installIntegrityScript], { cwd }),
      ).resolves.toMatchObject({ stdout: '', stderr: '' });
    },
  );
  it('rejects an incomplete direct package and does not read an absolute type path', async () => {
    const cwd = await fixture({
      ...complete,
      'node_modules/example/package.json': JSON.stringify({
        name: 'example',
        version: '1.0.0',
        types: '/outside-private-path',
      }),
    });
    await expect(
      execute(process.execPath, ['--input-type=module', '-e', installIntegrityScript], { cwd }),
    ).rejects.toMatchObject({ code: 86, stderr: 'JINGYUE_INSTALL_INCOMPLETE: node_modules/example\n' });
  });
});
