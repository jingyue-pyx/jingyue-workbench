import { createHash } from 'node:crypto';

export const PROJECT_BODY_LIMIT = 4 * 1024 * 1024;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const projectPath = /^\/api\/projects(?:\/([0-9a-f-]{36})(?:\/(checkpoint|delete|restore))?)?$/;
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => record(value) && Object.keys(value).every((key) => allowed.includes(key));
const shortString = (value, max, empty = false) =>
  typeof value === 'string' && value.length <= max && (empty || !!value.trim());

export class ProjectError extends Error {
  constructor(status, code, message, currentRevision) {
    super(message);
    this.status = status;
    this.code = code;
    this.currentRevision = currentRevision;
  }
}
export function invalid() {
  throw new ProjectError(422, 'INVALID_PROJECT', 'Project data is invalid or contains unsupported content');
}
export function projectRoute(path) {
  const match = projectPath.exec(path);
  if (!match || (match[1] && !UUID.test(match[1]))) return null;
  return { id: match[1], action: match[2] };
}

export function safeProjectPath(name) {
  if (
    !shortString(name, 1024) ||
    name.startsWith('/') ||
    /^[a-z]:/i.test(name) ||
    name.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(name)
  )
    return false;
  const parts = name.split('/');
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part === 'node_modules' ||
        part === '.git' ||
        part === '.ssh' ||
        part === '.aws',
    )
  )
    return false;
  const leaf = parts.at(-1).toLowerCase();
  return (
    !(/^\.env(?:\.|$)/.test(leaf) && !['.env.example', '.env.template'].includes(leaf)) &&
    !['.npmrc', '.pypirc', '.netrc', 'id_rsa', 'id_ed25519'].includes(leaf) &&
    !/\.(?:pem|key|p12|pfx)$/.test(leaf)
  );
}

export function containsCredential(value) {
  return /\bsb_secret_[a-zA-Z0-9_-]{20,}|\bsk-[a-zA-Z0-9_-]{20,}|\bLTAI[a-zA-Z0-9]{12,}|-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----|\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:@]+:[^\s/@]+@/i.test(
    value,
  );
}

function jsonSafe(value, depth = 0) {
  if (depth > 25) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value === 'string') return !containsCredential(value);
  if (Array.isArray(value)) return value.length <= 2000 && value.every((item) => jsonSafe(item, depth + 1));
  return (
    record(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        ![
          '__proto__',
          'constructor',
          'prototype',
          'apiKeys',
          'providerSettings',
          'password',
          'authorization',
          'databaseUrl',
        ].includes(key) && jsonSafe(item, depth + 1),
    )
  );
}

export function validateDocument(document) {
  if (
    !keys(document, ['schemaVersion', 'title', 'messages', 'snapshot', 'metadata']) ||
    document.schemaVersion !== 1 ||
    !shortString(document.title, 200)
  )
    invalid();
  if (!Array.isArray(document.messages) || document.messages.length > 1000) invalid();
  const ids = new Set();
  for (const message of document.messages) {
    if (
      !keys(message, ['id', 'role', 'content', 'createdAt', 'annotations']) ||
      !shortString(message.id, 200) ||
      ids.has(message.id) ||
      !['user', 'assistant', 'system'].includes(message.role)
    )
      invalid();
    ids.add(message.id);
    if (
      typeof message.content !== 'string' &&
      !(
        Array.isArray(message.content) &&
        message.content.length > 0 &&
        message.content.every(
          (part) => keys(part, ['type', 'text']) && part.type === 'text' && typeof part.text === 'string',
        )
      )
    )
      invalid();
    if (
      message.createdAt !== undefined &&
      (!shortString(message.createdAt, 100) || !Number.isFinite(Date.parse(message.createdAt)))
    )
      invalid();
    if (message.annotations !== undefined && !Array.isArray(message.annotations)) invalid();
  }
  if (document.metadata !== undefined) {
    if (!keys(document.metadata, ['gitUrl', 'gitBranch', 'netlifySiteId'])) invalid();
    for (const value of Object.values(document.metadata)) if (!shortString(value, 2048, true)) invalid();
    if (document.metadata.gitUrl) {
      let url;
      try {
        url = new URL(document.metadata.gitUrl);
      } catch {
        invalid();
      }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        invalid();
    }
  }
  if (document.snapshot !== null) {
    const snapshot = document.snapshot;
    if (
      !keys(snapshot, ['chatIndex', 'files', 'summary']) ||
      !ids.has(snapshot.chatIndex) ||
      !record(snapshot.files) ||
      Object.keys(snapshot.files).length > 2000
    )
      invalid();
    if (snapshot.summary !== undefined && !shortString(snapshot.summary, 100000, true)) invalid();
    const paths = new Set();
    for (const [name, entry] of Object.entries(snapshot.files)) {
      if (!safeProjectPath(name) || paths.has(name.normalize('NFC')) || !record(entry)) invalid();
      paths.add(name.normalize('NFC'));
      if (entry.isLocked !== undefined && typeof entry.isLocked !== 'boolean') invalid();
      if (entry.lockedByFolder !== undefined && !safeProjectPath(entry.lockedByFolder)) invalid();
      if (entry.type === 'folder') {
        if (!keys(entry, ['type', 'isLocked', 'lockedByFolder'])) invalid();
      } else if (entry.type === 'file') {
        if (
          !keys(entry, ['type', 'content', 'isBinary', 'isLocked', 'lockedByFolder']) ||
          typeof entry.content !== 'string' ||
          typeof entry.isBinary !== 'boolean'
        )
          invalid();
        if (Buffer.byteLength(entry.content) > 1024 * 1024)
          throw new ProjectError(413, 'PROJECT_TOO_LARGE', 'A project file exceeds the size limit');
        if (
          entry.isBinary &&
          (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.content) ||
            Buffer.from(entry.content, 'base64').toString('base64') !== entry.content)
        )
          invalid();
      } else invalid();
    }
  }
  if (!jsonSafe(document))
    throw new ProjectError(422, 'SENSITIVE_PROJECT_CONTENT', 'Project content contains unsupported or sensitive data');
  const serialized = JSON.stringify(document);
  if (Buffer.byteLength(serialized) > PROJECT_BODY_LIMIT)
    throw new ProjectError(413, 'PROJECT_TOO_LARGE', 'Project exceeds the size limit');
  return { document, bytes: Buffer.byteLength(serialized) };
}

export function validateMutation(route, body) {
  const action = route.id ? route.action : 'create';
  const allowed =
    action === 'create'
      ? ['projectId', 'requestId', 'document', 'migration']
      : action === 'checkpoint'
        ? ['requestId', 'baseRevision', 'document']
        : ['requestId', 'baseRevision'];
  if (!keys(body, allowed) || !UUID.test(body.requestId)) invalid();
  if (action === 'create') {
    if (!UUID.test(body.projectId)) invalid();
    if (
      body.migration !== undefined &&
      (!keys(body.migration, ['sourceId', 'legacyId']) ||
        !UUID.test(body.migration.sourceId) ||
        !shortString(body.migration.legacyId, 256))
    )
      invalid();
  } else if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 1 || body.baseRevision >= 2147483647)
    invalid();
  if (action === 'create' || action === 'checkpoint') validateDocument(body.document);
  return { action, projectId: route.id || body.projectId, ...body };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function mutationDigest(mutation) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(mutation)))
    .digest('hex');
}
