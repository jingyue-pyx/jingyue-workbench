import { ProjectError, UUID, mutationDigest, validateDocument } from './project-protocol.mjs';
import { DEMO_DATABASE_HOST, createPrivateDatabaseStream } from './private-database-network.mjs';

const unavailable = () =>
  new ProjectError(503, 'PERSISTENCE_UNAVAILABLE', 'Cloud project storage is temporarily unavailable');
const conflict = (revision) =>
  new ProjectError(
    409,
    'REVISION_CONFLICT',
    'The cloud project changed; keep your local copy and reload or save a copy',
    revision,
  );
const resultRow = (row, full = false) => ({
  projectId: row.id,
  revision: row.revision,
  ...(full ? { document: row.document } : {}),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
});

export function databaseOptions(env) {
  const demoMode = env.JINGYUE_DEMO_PRIVATE_PLAINTEXT === '1';
  if (
    (env.JINGYUE_DEMO_PRIVATE_PLAINTEXT !== undefined && !['0', '1'].includes(env.JINGYUE_DEMO_PRIVATE_PLAINTEXT)) ||
    (demoMode && env.JINGYUE_DEMO_PRIVATE_HOST !== DEMO_DATABASE_HOST) ||
    (!demoMode && env.JINGYUE_DEMO_PRIVATE_HOST !== undefined) ||
    (demoMode && env.JINGYUE_DATABASE_CA !== undefined)
  )
    throw unavailable();
  if (!env.JINGYUE_DATABASE_URL || !UUID.test(env.WORKBENCH_OWNER_ID || '')) return null;
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw unavailable();
  const url = new URL(env.JINGYUE_DATABASE_URL);
  // URL query SSL options can silently replace the verified TLS configuration.
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname.endsWith('.rds.aliyuncs.com') ||
    !url.username ||
    !url.password ||
    url.search ||
    url.hash ||
    (demoMode && (url.hostname !== DEMO_DATABASE_HOST || Number(url.port || 5432) !== 5432)) ||
    !/^\/[A-Za-z0-9_-]+$/.test(url.pathname)
  )
    throw unavailable();
  return {
    ownerId: env.WORKBENCH_OWNER_ID,
    pool: {
      host: url.hostname,
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      ssl: demoMode
        ? false
        : { rejectUnauthorized: true, ...(env.JINGYUE_DATABASE_CA ? { ca: env.JINGYUE_DATABASE_CA } : {}) },
      ...(demoMode ? { stream: () => createPrivateDatabaseStream() } : {}),
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
      query_timeout: 6000,
      lock_timeout: 1500,
      idle_in_transaction_session_timeout: 5000,
      application_name: 'jingyue-project-store',
    },
  };
}

export async function createProjectStore(env, report = () => {}) {
  try {
    const options = databaseOptions(env);
    if (!options) return null;
    const { Pool } = await import('pg');
    const pool = new Pool(options.pool);
    pool.on('error', () => report('project_database_connection_failed'));
    return new PostgresProjectStore(pool, options.ownerId);
  } catch {
    report('project_database_configuration_unavailable');
    return null;
  }
}

export class PostgresProjectStore {
  constructor(pool, ownerId) {
    if (!UUID.test(ownerId)) throw unavailable();
    this.pool = pool;
    this.ownerId = ownerId;
  }
  async list({ limit = 20, cursor, deleted = false }) {
    const params = [this.ownerId, deleted, limit + 1];
    let condition = '';
    if (cursor) {
      let decoded;
      try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      } catch {
        throw new ProjectError(422, 'INVALID_CURSOR', 'Invalid project list cursor');
      }
      if (
        !decoded ||
        !UUID.test(decoded.id) ||
        typeof decoded.at !== 'string' ||
        !Number.isFinite(Date.parse(decoded.at))
      )
        throw new ProjectError(422, 'INVALID_CURSOR', 'Invalid project list cursor');
      params.push(decoded.at, decoded.id);
      condition = 'AND (updated_at, id) < ($4::timestamptz, $5::uuid)';
    }
    const { rows } = await this.pool.query(
      `SELECT id, revision, document->>'title' AS title, created_at, updated_at, deleted_at,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM jingyue.projects WHERE owner_id=$1 AND (deleted_at IS NOT NULL)=$2 ${condition} ORDER BY updated_at DESC,id DESC LIMIT $3`,
      params,
    );
    const page = rows.slice(0, limit);
    const tail = page.at(-1);
    return {
      items: page.map((row) => ({ ...resultRow(row), title: row.title })),
      nextCursor:
        rows.length > limit
          ? Buffer.from(JSON.stringify({ at: tail.cursor_at, id: tail.id })).toString('base64url')
          : null,
    };
  }
  async get(id) {
    const { rows } = await this.pool.query(
      'SELECT id,revision,document,created_at,updated_at,deleted_at FROM jingyue.projects WHERE owner_id=$1 AND id=$2',
      [this.ownerId, id],
    );
    if (!rows.length) throw new ProjectError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    return resultRow(rows[0], true);
  }
  async mutate(mutation) {
    const client = await this.pool.connect();
    let begun = false;
    let discardConnection = false;
    try {
      await client.query('BEGIN');
      begun = true;
      // All writes for this small private workspace serialize in PostgreSQL,
      // including quota checks and retries from different FC instances/tabs.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [this.ownerId]);
      const hash = mutationDigest(mutation);
      const receipt = await client.query(
        'SELECT request_hash,result FROM jingyue.project_mutations WHERE owner_id=$1 AND request_id=$2',
        [this.ownerId, mutation.requestId],
      );
      if (receipt.rows.length) {
        if (receipt.rows[0].request_hash !== hash)
          throw new ProjectError(409, 'REQUEST_ID_REUSED', 'This request ID was already used for different content');
        await client.query('COMMIT');
        begun = false;
        return receipt.rows[0].result;
      }
      const found = await client.query(
        'SELECT id,revision,document,byte_count,created_at,updated_at,deleted_at FROM jingyue.projects WHERE owner_id=$1 AND id=$2 FOR UPDATE',
        [this.ownerId, mutation.projectId],
      );
      const current = found.rows[0];
      let changed;
      if (mutation.action === 'create') {
        if (current) throw new ProjectError(409, 'PROJECT_EXISTS', 'Project ID already exists', current.revision);
        if (mutation.migration) {
          const imported = await client.query(
            'SELECT id FROM jingyue.projects WHERE owner_id=$1 AND legacy_source_id=$2 AND legacy_chat_id=$3',
            [this.ownerId, mutation.migration.sourceId, mutation.migration.legacyId],
          );
          if (imported.rows.length)
            throw new ProjectError(409, 'MIGRATION_EXISTS', 'This local project was already migrated');
        }
        const { bytes } = validateDocument(mutation.document);
        await this.checkQuota(client, bytes, true);
        changed = await client.query(
          'INSERT INTO jingyue.projects(owner_id,id,revision,document,byte_count,legacy_source_id,legacy_chat_id) VALUES($1,$2,1,$3,$4,$5,$6) RETURNING id,revision,updated_at,deleted_at',
          [
            this.ownerId,
            mutation.projectId,
            mutation.document,
            bytes,
            mutation.migration?.sourceId || null,
            mutation.migration?.legacyId || null,
          ],
        );
      } else {
        if (!current) throw new ProjectError(404, 'PROJECT_NOT_FOUND', 'Project not found');
        if (current.revision !== mutation.baseRevision) throw conflict(current.revision);
        if (mutation.action !== 'restore' && current.deleted_at)
          throw new ProjectError(409, 'PROJECT_DELETED', 'Project is in the recycle bin', current.revision);
        if (mutation.action === 'checkpoint') {
          const { bytes } = validateDocument(mutation.document);
          await this.checkQuota(client, bytes - current.byte_count, false);
          changed = await client.query(
            'UPDATE jingyue.projects SET document=$3,byte_count=$4,revision=revision+1,updated_at=clock_timestamp() WHERE owner_id=$1 AND id=$2 AND revision=$5 RETURNING id,revision,updated_at,deleted_at',
            [this.ownerId, mutation.projectId, mutation.document, bytes, mutation.baseRevision],
          );
        } else if (mutation.action === 'delete' || mutation.action === 'restore') {
          if (mutation.action === 'restore' && !current.deleted_at)
            throw new ProjectError(409, 'PROJECT_NOT_DELETED', 'Project is not in the recycle bin', current.revision);
          changed = await client.query(
            `UPDATE jingyue.projects SET deleted_at=${mutation.action === 'delete' ? 'clock_timestamp()' : 'NULL'},revision=revision+1,updated_at=clock_timestamp() WHERE owner_id=$1 AND id=$2 AND revision=$3 RETURNING id,revision,updated_at,deleted_at`,
            [this.ownerId, mutation.projectId, mutation.baseRevision],
          );
        } else throw new ProjectError(422, 'INVALID_PROJECT', 'Invalid project operation');
      }
      if (!changed.rows.length) throw conflict(current?.revision);
      const row = changed.rows[0];
      const result = {
        projectId: row.id,
        revision: row.revision,
        updatedAt: new Date(row.updated_at).toISOString(),
        deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
      };
      await client.query(
        "DELETE FROM jingyue.project_mutations WHERE owner_id=$1 AND created_at < now() - interval '24 hours'",
        [this.ownerId],
      );
      const receipts = await client.query(
        'SELECT count(*)::integer AS count FROM jingyue.project_mutations WHERE owner_id=$1',
        [this.ownerId],
      );
      if (receipts.rows[0].count >= 10000)
        throw new ProjectError(429, 'PROJECT_RATE_LIMIT', 'Too many project changes; retry later');
      await client.query(
        'INSERT INTO jingyue.project_mutations(owner_id,request_id,request_hash,result) VALUES($1,$2,$3,$4)',
        [this.ownerId, mutation.requestId, hash, result],
      );
      await client.query('COMMIT');
      begun = false;
      return result;
    } catch (error) {
      if (begun) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discardConnection = true;
        }
      }
      throw error;
    } finally {
      client.release(discardConnection);
    }
  }
  async checkQuota(client, addedBytes, creating) {
    const { rows } = await client.query(
      'SELECT count(*)::integer AS count,coalesce(sum(byte_count),0)::bigint AS bytes FROM jingyue.projects WHERE owner_id=$1',
      [this.ownerId],
    );
    if ((creating && rows[0].count >= 100) || Number(rows[0].bytes) + addedBytes > 200 * 1024 * 1024)
      throw new ProjectError(413, 'PROJECT_QUOTA_EXCEEDED', 'Private project storage quota exceeded');
  }
  close() {
    return this.pool.end();
  }
}
