import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeLocalPublishingConfig } from './publishing/init-local.mjs';
import { credentialVault } from './publishing/store.mjs';

test('local publishing setup creates a private key and never rotates an existing one implicitly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jingyue-publishing-config-'));
  const path = join(directory, '.publishing.local.env');
  await initializeLocalPublishingConfig(path, 'test-client-id');
  const before = await readFile(path, 'utf8');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const key = before.match(/^JINGYUE_PUBLISHING_ENCRYPTION_KEY=(.+)$/m)[1];
  const vault = credentialVault(key);
  assert.equal(vault.open('test-user', vault.seal('test-user', 'test-value')), 'test-value');
  await assert.rejects(initializeLocalPublishingConfig(path, 'another-client'), { code: 'EEXIST' });
  assert.equal(await readFile(path, 'utf8'), before);
  await assert.rejects(initializeLocalPublishingConfig(join(directory, 'invalid'), 'bad\nvalue'));
});
