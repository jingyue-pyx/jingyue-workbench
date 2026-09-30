import { access, cp, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Each running local preview owns its client assets and server manifest. A later
// Vite build must not delete files still referenced by an older running server.
export async function snapshotPreviewBuild(buildDirectory, releasesDirectory, port) {
  if (!Number.isInteger(port) || port < 9025 || port > 9035) throw new Error('Invalid local preview port.');
  const sourceEntry = join(buildDirectory, 'server/index.js');
  const manifestBefore = await readFile(sourceEntry, 'utf8');
  await mkdir(releasesDirectory, { recursive: true });
  const directory = await mkdtemp(join(releasesDirectory, `managed-${port}-`));
  await cp(buildDirectory, join(directory, 'build'), { recursive: true, errorOnExist: true, force: false });
  const serverEntry = join(directory, 'build/server/index.js');
  const clientDirectory = join(directory, 'build/client');
  const [manifestCopied, manifestAfter] = await Promise.all([
    readFile(serverEntry, 'utf8'),
    readFile(sourceEntry, 'utf8'),
  ]);
  if (manifestBefore !== manifestAfter || manifestBefore !== manifestCopied)
    throw new Error('Build changed while taking preview snapshot; finish the build and retry.');
  // Fail before booting the database rather than serving an HTML shell whose
  // route modules or styles do not exist. Never repair a mismatch by disabling auth.
  const assets = new Set(manifestCopied.match(/\/assets\/[\w.-]+\.(?:js|css)\b/g) || []);
  if (!assets.size) throw new Error('Preview build has no client asset references.');
  for (const asset of assets) {
    try {
      await access(join(clientDirectory, asset.slice(1)));
    } catch {
      throw new Error(`Preview build references a missing client asset: ${asset}`);
    }
  }
  return { directory, serverEntry, clientDirectory };
}
