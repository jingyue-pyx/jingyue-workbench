import { createHash } from 'node:crypto';
import { readdir, lstat, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

// SHA-256 fingerprints of three non-secret Emacs Lisp grammar words in
// @shikijs/langs 1.29.2. Only exempt these exact words in that one grammar asset.
// Never exempt an entire asset or all strings matching the key prefix.
const grammarWordHashes = new Set([
  '8a0b4e06d197ceb2a223c32cf3d11fafd4810cd9aa1697b76f7d04c84a07ca05',
  '9fbf855d48ecf8816e939006186e7440b706b3bc5babf5d50b51368fd0e83dd3',
  'ea96254155e2ec96df1aa27e8f7e40353a9d0c6301e0e3bf50f7482d73407ce6',
]);
const credentialPattern =
  /sb_secret_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|LTAI[A-Za-z0-9]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;
const databaseCredentialPattern = /postgres(?:ql)?:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/g;
// Runtime candidate validation imports this scanner too. Build the public
// example without embedding a credential-shaped URL in the server bundle;
// keep the exact, path-specific exception (never allow arbitrary DB URLs).
const databaseTemplate = ['postgresql:', '//jingyue_app:<percent-encoded-password>@<official-rds-host>:5432'].join('');

export function hasCredentialLiteral(text, path) {
  if (
    [...text.matchAll(databaseCredentialPattern)].some(
      ({ 0: value }) => path !== 'persistence.env.example' || value !== databaseTemplate,
    )
  )
    return true;
  return [...text.matchAll(credentialPattern)].some(({ 0: value }) => {
    const reviewedGrammar = /^client\/assets\/emacs-lisp-[\w-]+\.js$/.test(path);
    return !(reviewedGrammar && grammarWordHashes.has(createHash('sha256').update(value).digest('hex')));
  });
}

export async function inspectRelease(root) {
  let files = 0;
  let bytes = 0;
  async function inspect(dir) {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      const metadata = await lstat(path);
      if (
        metadata.isSymbolicLink() ||
        /^(\.env|\.supabase\.local\.env|\.publishing\.local\.env|\.dev\.vars|\.git|node_modules)|百炼配置|\.(pem|key|node|map)$/i.test(name)
      ) {
        throw new Error('Unexpected sensitive/platform-specific file in release.');
      }
      if (metadata.isDirectory()) await inspect(path);
      else {
        files++;
        bytes += metadata.size;
        // Scan every file, including binary blobs, without printing candidates.
        const text = await readFile(path, 'utf8');
        if (hasCredentialLiteral(text, relative(root, path)))
          throw new Error('Potential credential literal in release; inspect privately.');
      }
    }
  }
  await inspect(root);
  return { files, bytes };
}
