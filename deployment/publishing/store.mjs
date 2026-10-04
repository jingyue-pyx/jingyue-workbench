import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { fail } from './protocol.mjs';

export function credentialVault(encodedKey) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey || ''))
    throw new Error('Publishing requires a base64 32-byte encryption key.');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) throw new Error('Invalid publishing encryption key.');
  return {
    seal(owner, token) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(`jingyue:netlify:${owner}`));
      const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
    },
    open(owner, value) {
      try {
        const [iv, tag, data] = value.split('.').map((p) => Buffer.from(p, 'base64'));
        const cipher = createDecipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.from(`jingyue:netlify:${owner}`));
        cipher.setAuthTag(tag);
        return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
      } catch {
        fail('CONNECTION_UNAVAILABLE', '授权凭据不可用，请重新连接 Netlify。', 409);
      }
    },
  };
}

// Small transactions only. Provider requests happen outside locks. A lease
// coordinates polls across gateway instances without holding a DB connection.
export class PublishingStore {
  constructor(pool) {
    this.pool = pool;
  }
  async get(owner, key) {
    return (
      (
        await this.pool.query('SELECT document FROM jingyue.publishing_state WHERE owner_id=$1 AND resource_key=$2', [
          owner,
          key,
        ])
      ).rows[0]?.document ?? null
    );
  }
  async change(owner, key, update) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`publish:${owner}:${key}`]);
      const old =
        (
          await client.query('SELECT document FROM jingyue.publishing_state WHERE owner_id=$1 AND resource_key=$2', [
            owner,
            key,
          ])
        ).rows[0]?.document ?? null;
      const next = update(old);
      if (next === null)
        await client.query('DELETE FROM jingyue.publishing_state WHERE owner_id=$1 AND resource_key=$2', [owner, key]);
      else
        await client.query(
          `INSERT INTO jingyue.publishing_state (owner_id,resource_key,document) VALUES ($1,$2,$3::jsonb)
        ON CONFLICT (owner_id,resource_key) DO UPDATE SET document=excluded.document,revision=jingyue.publishing_state.revision+1,updated_at=now()`,
          [owner, key, JSON.stringify(next)],
        );
      await client.query('COMMIT');
      return next;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async lease(owner, key) {
    const lease = randomUUID();
    const data = await this.change(owner, key, (state) => {
      if (!state) fail('PUBLISH_NOT_FOUND', '发布记录不存在。', 404);
      if (state.leaseUntil > Date.now()) fail('PUBLISH_BUSY', '正在处理，请稍后查询。', 409);
      return { ...state, lease, leaseUntil: Date.now() + 60000 };
    });
    return {
      data,
      save: (next) =>
        this.change(owner, key, (old) => {
          if (old?.lease !== lease) fail('PUBLISH_BUSY', '任务已更新，请重新查询。', 409);
          return { ...next, lease: null, leaseUntil: 0 };
        }),
    };
  }
}
