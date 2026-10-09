import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { authenticated } from './security.mjs';
import { Passport } from 'passport';
import { Strategy } from 'passport-local';

const derive = promisify(scrypt);
const hashOptions = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
export const SESSION_SECONDS = 12 * 60 * 60;
const digest = (value) => createHash('sha256').update(value).digest('hex');
export class AccountError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}
export function usernameKey(value) {
  if (typeof value !== 'string') return '';
  const result = value.normalize('NFKC').trim().toLowerCase();
  return /^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,31}$/u.test(result) ? result : '';
}
export function validPassword(value) {
  return (
    typeof value === 'string' && [...value].length >= 15 && [...value].length <= 128 && Buffer.byteLength(value) <= 512
  );
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, hashOptions);
  return `scrypt-v1$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const parts = typeof encoded === 'string' ? encoded.split('$') : [];
  if (
    parts.length !== 3 ||
    parts[0] !== 'scrypt-v1' ||
    !/^[a-f0-9]{32}$/.test(parts[1]) ||
    !/^[a-f0-9]{128}$/.test(parts[2])
  )
    return false;
  const key = await derive(password, parts[1], 64, hashOptions);
  return timingSafeEqual(key, Buffer.from(parts[2], 'hex'));
}
const cookieName = (localTest, namespace) =>
  localTest
    ? `jingyue_session_test${typeof namespace === 'string' && /^[a-z0-9-]{1,24}$/.test(namespace) ? `_${namespace}` : ''}`
    : '__Host-jingyue_session';
export function sessionCookie(token, localTest, clear = false, namespace) {
  const name = cookieName(localTest, namespace);
  return `${name}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${localTest ? '' : '; Secure'}`;
}
export function readSession(cookie, localTest, namespace) {
  const name = cookieName(localTest, namespace);
  const matches = (cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
const publicUser = (row) => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  legacyOwner: row.legacy_owner,
});
export function displayName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim().normalize('NFKC');
  return [...name].length >= 1 && [...name].length <= 40 && !/[\u0000-\u001f\u007f]/.test(name) ? name : '';
}

export class AccountStore {
  constructor(pool, config, legacyOwnerId) {
    this.pool = pool;
    this.config = config;
    this.legacyOwnerId = legacyOwnerId;
    this.dummyHash = null;
    this.hashing = 0;
    this.passport = new Passport();
    this.passport.use(
      new Strategy((username, password, done) => {
        this.verifyCredentials(username, password).then((user) => done(null, user), done);
      }),
    );
  }
  async withHash(operation) {
    if (this.hashing >= 2) throw new AccountError(429, 'AUTH_BUSY', '登录请求较多，请稍后重试。');
    this.hashing++;
    try {
      return await operation();
    } finally {
      this.hashing--;
    }
  }
  async consume(key, limit, seconds) {
    const bucket = `${key}:${Math.floor(Date.now() / (seconds * 1000))}`;
    const { rows } = await this.pool.query(
      `INSERT INTO jingyue.account_limits(bucket, count, expires_at) VALUES($1,1,clock_timestamp()+($3::integer * interval '1 second'))
       ON CONFLICT(bucket) DO UPDATE SET count=account_limits.count+1 WHERE account_limits.count < $2 RETURNING count`,
      [bucket, limit, seconds * 2],
    );
    if (!rows.length) throw new AccountError(429, 'ACCOUNT_RATE_LIMIT', '操作过于频繁或今日额度已用完，请稍后再试。');
  }
  async guardAttempt(kind, username, address) {
    await this.consume('auth-global', 120, 900);
    await this.consume(`auth-address:${digest(address || 'unknown')}`, 40, 900);
    await this.consume(`auth-${kind}:${digest(username)}`, kind === 'register' ? 5 : 10, 900);
  }
  async createSession(user) {
    const token = randomBytes(32).toString('base64url');
    const client = await this.pool.connect();
    let begun = false;
    let discard = false;
    try {
      await client.query('BEGIN');
      begun = true;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`sessions:${user.id}`]);
      await client.query('DELETE FROM jingyue.account_sessions WHERE expires_at <= clock_timestamp()');
      await client.query('DELETE FROM jingyue.account_limits WHERE expires_at <= clock_timestamp()');
      // Limit concurrent sessions without storing a reusable plaintext token.
      await client.query(
        'DELETE FROM jingyue.account_sessions WHERE user_id=$1 AND token_hash IN (SELECT token_hash FROM jingyue.account_sessions WHERE user_id=$1 ORDER BY created_at DESC OFFSET 9)',
        [user.id],
      );
      await client.query(
        "INSERT INTO jingyue.account_sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+($3::integer * interval '1 second'))",
        [digest(token), user.id, SESSION_SECONDS],
      );
      await client.query('COMMIT');
      begun = false;
      return { user: publicUser(user), token };
    } catch (error) {
      if (begun) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }
  async register({ username, password, displayName: label }, address) {
    const name = usernameKey(username);
    const visibleName = displayName(label);
    if (!this.config.registrationOpen) throw new AccountError(403, 'REGISTRATION_CLOSED', '暂未开放新用户注册。');
    if (!name || !visibleName || !validPassword(password))
      throw new AccountError(
        422,
        'INVALID_ACCOUNT',
        '显示名需为 1–40 位；账号需为 3–32 位文字、数字、下划线、点或短横线；密码需为 15–128 位。',
      );
    await this.guardAttempt('register', name, address);
    if (name === this.config.legacyUsername)
      throw new AccountError(409, 'USERNAME_UNAVAILABLE', '该用户名不可用，请更换。');
    return this.withHash(async () => {
      const passwordHash = await hashPassword(password);
      const client = await this.pool.connect();
      let begun = false;
      let discard = false;
      let user;
      try {
        await client.query('BEGIN');
        begun = true;
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('account-registration',0))");
        const count = await client.query('SELECT count(*)::integer AS count FROM jingyue.accounts');
        if (count.rows[0].count >= this.config.maxAccounts)
          throw new AccountError(403, 'REGISTRATION_CAPACITY', '内测账号名额已满，请联系管理员。');
        const result = await client.query(
          'INSERT INTO jingyue.accounts(id,username,password_hash,display_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id,username,display_name,legacy_owner',
          [randomUUID(), name, passwordHash, visibleName],
        );
        if (!result.rows.length) throw new AccountError(409, 'USERNAME_UNAVAILABLE', '该用户名不可用，请更换。');
        user = result.rows[0];
        await client.query('COMMIT');
        begun = false;
      } catch (error) {
        if (begun) {
          try {
            await client.query('ROLLBACK');
          } catch {
            discard = true;
          }
        }
        throw error;
      } finally {
        client.release(discard);
      }
      return this.createSession(user);
    });
  }
  async login({ username, password }, address) {
    const name = usernameKey(username);
    if (!name || typeof password !== 'string' || !password || Buffer.byteLength(password) > 512)
      throw new AccountError(401, 'INVALID_LOGIN', '用户名或密码不正确。');
    await this.guardAttempt('login', name, address);
    return this.withHash(async () => {
      const user = await new Promise((resolve, reject) => {
        this.passport.authenticate('local', { session: false }, (error, user) => {
          if (error) reject(error);
          else if (!user) reject(new AccountError(401, 'INVALID_LOGIN', '账号或密码不正确。'));
          else resolve(user);
        })({ body: { username: name, password } }, {}, reject);
      });
      return this.createSession(user);
    });
  }
  async verifyCredentials(name, password) {
    let { rows } = await this.pool.query(
      'SELECT id,username,display_name,password_hash,legacy_owner,disabled FROM jingyue.accounts WHERE username=$1',
      [name],
    );
    // Only proof of the old shared credentials can claim the existing workspace.
    // The first public registrant never becomes its owner or an administrator.
    if (
      !rows.length &&
      name === this.config.legacyUsername &&
      authenticated(
        'Basic ' + Buffer.from(`${this.config.legacyAccessUser}:${password}`).toString('base64'),
        this.config,
      )
    ) {
      const passwordHash = await hashPassword(password);
      await this.pool.query(
        'INSERT INTO jingyue.accounts(id,username,display_name,password_hash,legacy_owner) VALUES($1,$2,$2,$3,true) ON CONFLICT DO NOTHING',
        [this.legacyOwnerId, name, passwordHash],
      );
      ({ rows } = await this.pool.query(
        'SELECT id,username,display_name,password_hash,legacy_owner,disabled FROM jingyue.accounts WHERE username=$1',
        [name],
      ));
    }
    // Unknown names perform the same expensive password operation.
    this.dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
    const valid = await verifyPassword(password, rows[0]?.password_hash || (await this.dummyHash));
    if (!valid || !rows.length || rows[0].disabled)
      throw new AccountError(401, 'INVALID_LOGIN', '用户名或密码不正确。');
    return rows[0];
  }
  async rename(user, label) {
    const name = displayName(label);
    if (!name) throw new AccountError(422, 'INVALID_DISPLAY_NAME', '显示名需为 1–40 位。');
    const { rows } = await this.pool.query(
      'UPDATE jingyue.accounts SET display_name=$2 WHERE id=$1 AND NOT disabled RETURNING id,username,display_name,legacy_owner',
      [user.id, name],
    );
    if (!rows.length) throw new AccountError(401, 'SESSION_EXPIRED', '请重新登录。');
    return publicUser(rows[0]);
  }
  async authenticate(token) {
    if (!token) return null;
    const { rows } = await this.pool.query(
      'SELECT a.id,a.username,a.display_name,a.legacy_owner FROM jingyue.account_sessions s JOIN jingyue.accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp() AND NOT a.disabled',
      [digest(token)],
    );
    return rows.length ? publicUser(rows[0]) : null;
  }
  async logout(token) {
    if (token) await this.pool.query('DELETE FROM jingyue.account_sessions WHERE token_hash=$1', [digest(token)]);
  }
  async allowModel(user) {
    if (this.config.globalDailyRequests !== 0)
      await this.consume('model-global', this.config.globalDailyRequests, 86400);
    if (this.config.userDailyRequests !== 0)
      await this.consume(`model-user:${user.id}`, this.config.userDailyRequests, 86400);
  }
}
