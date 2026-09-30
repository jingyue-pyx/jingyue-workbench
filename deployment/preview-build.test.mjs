import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshotPreviewBuild } from './preview-build.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'jingyue-preview-build-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const build = join(directory, 'build');
  await mkdir(join(build, 'server'), { recursive: true });
  await mkdir(join(build, 'client/assets'), { recursive: true });
  return { build, releases: join(directory, 'releases') };
}

test('a running preview keeps its matching assets after the shared build is replaced', async (t) => {
  const { build, releases } = await fixture(t);
  await writeFile(join(build, 'server/index.js'), 'export const route = "/assets/home-old.js";');
  await writeFile(join(build, 'client/assets/home-old.js'), 'old-client');
  const first = await snapshotPreviewBuild(build, releases, 9025);
  await rm(join(build, 'client/assets/home-old.js'));
  await writeFile(join(build, 'server/index.js'), 'export const route = "/assets/home-new.js";');
  await writeFile(join(build, 'client/assets/home-new.js'), 'new-client');
  const second = await snapshotPreviewBuild(build, releases, 9026);
  assert.notEqual(first.directory, second.directory);
  assert.equal(await readFile(join(first.clientDirectory, 'assets/home-old.js'), 'utf8'), 'old-client');
  assert.match(await readFile(first.serverEntry, 'utf8'), /home-old/);
  assert.equal(await readFile(join(second.clientDirectory, 'assets/home-new.js'), 'utf8'), 'new-client');
});

test('a mismatched build is rejected before serving a blank authenticated page', async (t) => {
  const { build, releases } = await fixture(t);
  await writeFile(join(build, 'server/index.js'), 'export const route = "/assets/missing.js";');
  await assert.rejects(snapshotPreviewBuild(build, releases, 9025), /missing client asset/);
});

test('styles are checked too, and each restart gets a distinct snapshot', async (t) => {
  const { build, releases } = await fixture(t);
  await writeFile(join(build, 'server/index.js'), 'export const styles = ["/assets/home.css"];');
  await assert.rejects(snapshotPreviewBuild(build, releases, 9025), /home.css/);
  await writeFile(join(build, 'client/assets/home.css'), 'body{margin:0}');
  const first = await snapshotPreviewBuild(build, releases, 9025);
  const second = await snapshotPreviewBuild(build, releases, 9025);
  assert.notEqual(first.directory, second.directory);
});
