// Local-only setup. Generate the vault key without displaying it or overwriting
// an existing configuration (which could make saved authorizations unreadable).
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { identifier } from './protocol.mjs';

export async function initializeLocalPublishingConfig(path, clientId) {
  if (!identifier(clientId)) throw new Error('A valid public Netlify Client ID is required.');
  await writeFile(path, [
    '# Local server-side publishing configuration. Never commit or print.',
    'JINGYUE_NETLIFY_ENABLED=1',
    `JINGYUE_NETLIFY_CLIENT_ID=${clientId}`,
    `JINGYUE_PUBLISHING_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await initializeLocalPublishingConfig(fileURLToPath(new URL('../../.publishing.local.env', import.meta.url)), process.argv[2]);
    process.stdout.write('Local publishing configuration created with owner-only permissions. Secret values were not printed.\n');
  } catch (error) {
    process.stderr.write(error.code === 'EEXIST' ? 'Configuration already exists; it was not changed.\n' : 'Unable to initialize local publishing configuration.\n');
    process.exitCode = 1;
  }
}
