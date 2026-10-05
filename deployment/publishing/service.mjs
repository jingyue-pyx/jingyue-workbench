import { createHash, randomUUID } from 'node:crypto';
import { PublishingError, fail, hash, identifier, publicSiteURL, uuid, validateArtifacts } from './protocol.mjs';
import { credentialVault, PublishingStore } from './store.mjs';
import { NetlifyProvider, readLimited } from './netlify.mjs';

const terminal = new Set(['published', 'access_unverified', 'failed']);
const projectKey = (id) => `project:${id}`;
const connectionKey = 'netlify';
const jobView = (state) =>
  state?.job
    ? {
        id: state.job.id,
        phase: state.job.phase,
        revision: state.job.revision,
        url: state.job.url || null,
        manageUrl: state.siteId
          ? `https://app.netlify.com/projects/${encodeURIComponent(state.siteId)}/overview`
          : null,
        error: state.job.error || null,
        uploaded: state.job.uploaded || 0,
        fileCount: state.job.fileCount,
        lastPublished: state.lastPublished || null,
      }
    : { phase: 'idle', lastPublished: state?.lastPublished || null };

export function createPublishingService(env, projects, fetchImpl = globalThis.fetch) {
  if (env.JINGYUE_NETLIFY_ENABLED !== '1') return null;
  if (!projects?.pool || !identifier(env.JINGYUE_NETLIFY_CLIENT_ID))
    throw new Error('Publishing requires project storage and an owned Netlify OAuth application.');
  return new PublishingService({
    store: new PublishingStore(projects.pool),
    projects,
    clientId: env.JINGYUE_NETLIFY_CLIENT_ID,
    vault: credentialVault(env.JINGYUE_PUBLISHING_ENCRYPTION_KEY),
    provider: new NetlifyProvider(fetchImpl),
    fetchImpl,
  });
}

export class PublishingService {
  constructor({ store, projects, clientId, vault, provider, fetchImpl = globalThis.fetch }) {
    Object.assign(this, { store, projects, clientId, vault, provider, fetchImpl });
  }
  async connection(owner) {
    const state = await this.store.get(owner, connectionKey);
    if (!state?.credential) fail('NOT_CONNECTED', '请先授权连接你自己的 Netlify 账号。', 409);
    return { state, token: this.vault.open(owner, state.credential) };
  }
  async status(owner) {
    const state = await this.store.get(owner, connectionKey);
    return { enabled: true, connected: !!state?.credential, displayName: state?.displayName || null };
  }
  async connect(owner, session) {
    await this.store.change(owner, connectionKey, (old) => {
      if (old?.credential) fail('ALREADY_CONNECTED', '已经连接，请先解除旧授权绑定。', 409);
      if (old?.leaseUntil > Date.now()) fail('PUBLISH_BUSY', '正在准备授权，请稍后再试。', 409);
      if (old?.startedAt > Date.now() - 30000) fail('CONNECT_RATE_LIMIT', '请等待 30 秒后重新发起授权。', 429);
      return { startedAt: Date.now() };
    });
    const { data, save } = await this.store.lease(owner, connectionKey);
    try {
      const ticket = await this.provider.ticket(this.clientId);
      if (!identifier(ticket.id)) fail('PROVIDER_RESPONSE', '授权信息无效，请重试。', 502);
      const attempt = {
        id: randomUUID(),
        ticket: this.vault.seal(owner, ticket.id),
        session,
        expiresAt: Date.now() + 10 * 60000,
      };
      await save({ ...data, attempt });
      return {
        attemptId: attempt.id,
        authorizeUrl: `https://app.netlify.com/authorize?response_type=ticket&ticket=${encodeURIComponent(ticket.id)}`,
      };
    } catch (error) {
      await save({ ...data, attempt: null });
      throw error;
    }
  }
  async authorize(owner, session, attemptId) {
    const { data, save } = await this.store.lease(owner, connectionKey);
    try {
      const attempt = data.attempt;
      if (!attempt || attempt.id !== attemptId || attempt.session !== session || attempt.expiresAt < Date.now())
        fail('AUTH_EXPIRED', '授权已过期或来自另一会话，请重新连接。', 409);
      const ticket = this.vault.open(owner, attempt.ticket);
      if (!(await this.provider.ticketStatus(ticket)).authorized) {
        await save(data);
        return { pending: true };
      }
      const result = await this.provider.exchange(ticket);
      if (
        typeof result.access_token !== 'string' ||
        result.access_token.length < 10 ||
        result.access_token.length > 4096
      )
        fail('PROVIDER_RESPONSE', '授权返回无效，请重新连接。', 502);
      const user = await this.provider.user(result.access_token);
      if (!identifier(user.id) || (result.user_id && result.user_id !== user.id))
        fail('PROVIDER_RESPONSE', 'Netlify 身份核验失败。', 502);
      await save({
        credential: this.vault.seal(owner, result.access_token),
        providerUserId: user.id,
        connectionId: randomUUID(),
        displayName: String(user.full_name || 'Netlify 用户').slice(0, 100),
      });
      return { pending: false, connected: true };
    } catch (error) {
      await save({ ...data, ...(error.code === 'AUTH_EXPIRED' ? { attempt: null } : {}) });
      throw error;
    }
  }
  async disconnect(owner) {
    await this.store.change(owner, connectionKey, (old) => {
      if (old?.leaseUntil > Date.now()) fail('PUBLISH_BUSY', '授权仍在处理，请稍后断开。', 409);
      return null;
    });
    return { connected: false, message: '已删除鲸月保存的授权；网站未删除。请到 Netlify 撤销应用授权。' };
  }
  async teams(owner) {
    const { token } = await this.connection(owner);
    const accounts = await this.provider.accounts(token);
    if (!Array.isArray(accounts)) fail('PROVIDER_RESPONSE', '团队列表无效。', 502);
    return {
      teams: accounts
        .filter((a) => identifier(a.id) && identifier(a.slug))
        .slice(0, 100)
        .map((a) => ({ id: a.id, slug: a.slug, name: String(a.name || a.slug).slice(0, 100) })),
    };
  }
  async project(owner, id) {
    if (!uuid(id)) fail('INVALID_PROJECT', '项目标识无效。');
    const project = await this.projects.forOwner(owner).get(id);
    if (project.deletedAt) fail('PROJECT_DELETED', '项目已删除，不能发布。', 409);
    return project;
  }
  async job(owner, id) {
    await this.project(owner, id);
    return jobView(await this.store.get(owner, projectKey(id)));
  }
  async prepare(owner, input) {
    if (!uuid(input.requestId) || !Number.isSafeInteger(input.revision) || input.confirmPublic !== true)
      fail('PUBLISH_CONFIRMATION', '请确认发布已保存版本，内容将公开并使用你的 Netlify 额度。');
    const project = await this.project(owner, input.projectId);
    if (project.revision !== input.revision) fail('SOURCE_CHANGED', '源码版本已更新，请重新构建后发布。', 409);
    const { state: connection } = await this.connection(owner);
    const { teams } = await this.teams(owner);
    const team = teams.find((t) => t.id === input.teamId);
    if (!team) fail('TEAM_FORBIDDEN', '此账号无法访问所选 Netlify 团队。', 403);
    const files = validateArtifacts(input.files);
    const payloadHash = hash(JSON.stringify({ files, revision: input.revision, team: team.id }));
    const state = await this.store.change(owner, projectKey(input.projectId), (old) => {
      if (old?.leaseUntil > Date.now()) fail('PUBLISH_BUSY', '已有发布请求正在处理，请稍后查询。', 409);
      if (old?.job?.requestId === input.requestId) {
        if (old.job.payloadHash !== payloadHash) fail('REQUEST_REUSED', '发布请求已被使用，请重新构建。', 409);
        return old;
      }
      if (old?.job && !terminal.has(old.job.phase)) fail('PUBLISH_BUSY', '此项目已有发布，请先查询其结果。', 409);
      if (old?.team && (old.team.id !== team.id || old.providerUserId !== connection.providerUserId))
        fail('SITE_BINDING_MISMATCH', '此项目已绑定其他账号或团队；不能覆盖现有站点。', 409);
      const id = randomUUID();
      const systemFiles = [
        ['_jingyue_release.txt', id],
        ['_redirects', '/* /index.html 200\n'],
      ].map(([path, text]) => ({
        path,
        base64: Buffer.from(text).toString('base64'),
        digest: createHash('sha1').update(text).digest('hex'),
      }));
      const deployFiles = [...files.filter((f) => f.path !== '_jingyue_release.txt'), ...systemFiles];
      return {
        ...old,
        team,
        providerUserId: connection.providerUserId,
        siteName: old?.siteName || `jy-${hash(`${owner}:${input.projectId}`).slice(0, 24)}`,
        job: {
          id,
          requestId: input.requestId,
          payloadHash,
          revision: input.revision,
          connectionId: connection.connectionId,
          phase: 'prepared',
          files: deployFiles,
          fileCount: deployFiles.length,
          uploaded: 0,
          startedAt: Date.now(),
        },
      };
    });
    return jobView(state);
  }
  async advance(owner, projectId) {
    await this.project(owner, projectId);
    const { data, save } = await this.store.lease(owner, projectKey(projectId));
    let state = data;
    const persist = async () => {
      // Keep the same lease during a step; save() releases it only at return.
      await this.store.change(owner, projectKey(projectId), (old) => {
        if (old?.lease !== data.lease) fail('PUBLISH_BUSY', '任务已更新，请重新查询。', 409);
        return state;
      });
    };
    try {
      const { state: connection, token } = await this.connection(owner);
      const job = state.job;
      if (!job) fail('PUBLISH_NOT_FOUND', '没有发布任务。', 404);
      if (connection.connectionId !== job.connectionId) {
        if (connection.providerUserId !== state.providerUserId)
          fail('CONNECTION_CHANGED', '授权账号已变更，旧发布已停止推进；请检查 Netlify 中的状态。', 409);
        job.connectionId = connection.connectionId;
      }
      if (job.phase === 'published' || job.phase === 'failed') {
        await save(state);
        return jobView(state);
      }
      if (Date.now() - job.startedAt > 30 * 60000 && !terminal.has(job.phase)) {
        fail('PUBLISH_EXPIRED', '发布已超过 30 分钟，请在 Netlify 核对结果，不能盲目重复创建。', 409);
      }
      // Re-verify the target on every step, not a browser-provided remote ID.
      if (state.siteId) {
        const site = await this.provider.site(token, state.siteId);
        if (site.account_id !== state.team.id || site.id !== state.siteId)
          fail('SITE_FORBIDDEN', '站点归属已变化，已停止发布。', 403);
      }
      if (job.phase === 'prepared' && !state.siteId) {
        job.phase = 'creating_site';
        await persist(); // An uncertain POST is never automatically replayed.
        const site = await this.provider.createSite(token, state.team.slug, state.siteName);
        this.acceptSite(state, site);
        job.phase = 'prepared';
      } else if (job.phase === 'creating_site') {
        // Netlify also accepts a site's full default domain as its identifier.
        const site = await this.provider.siteByName(token, state.siteName);
        this.acceptSite(state, site);
        job.phase = 'prepared';
      } else if (job.phase === 'prepared') {
        job.phase = 'creating_deploy';
        await persist();
        const deploy = await this.provider.deploy(token, state.siteId, `jingyue:${job.id}`, job.files);
        this.acceptDeploy(state, deploy);
      } else if (job.phase === 'creating_deploy') {
        const deployments = await this.provider.deployments(token, state.siteId);
        const found = Array.isArray(deployments) && deployments.find((d) => d.title === `jingyue:${job.id}`);
        if (!found)
          fail('PUBLISH_UNCERTAIN', '正在核对上次提交结果，未重复创建部署。请稍后查询或到 Netlify 核对。', 409);
        this.acceptDeploy(state, found);
      } else if (job.phase === 'uploading' || job.phase === 'waiting') {
        const deploy = await this.provider.deployment(token, job.deployId);
        if (deploy.site_id !== state.siteId) fail('SITE_FORBIDDEN', '部署归属不一致。', 403);
        if (deploy.state === 'error') {
          job.phase = 'failed';
          job.error = 'Netlify 构建产物处理失败，请在平台查看详情。';
          delete job.files;
        } else if (deploy.state === 'ready') {
          const url = publicSiteURL(deploy.ssl_url);
          if (!url) fail('PROVIDER_RESPONSE', 'Netlify 返回的网站地址无效，保留发布记录，请稍后查询。', 502);
          job.url = url;
          job.phase = 'access_unverified';
          delete job.files;
        } else {
          // `required` is a manifest, not a durable remaining-work queue. In
          // async deploys later GETs can omit hashes before all PUTs finish.
          // Keep our queue across requests/restarts and persist it before PUT.
          if (['new', 'pending', 'preparing'].includes(deploy.state)) {
            job.phase = 'uploading';
            await save(state);
            return jobView(state);
          }
          this.acceptManifest(job, deploy);
          if (!job.pendingDigests) {
            // Recover jobs created by the old polling implementation. Re-PUT
            // immutable artifacts to the SAME deploy; never create another one.
            if (job.uploaded > 0 && deploy.state === 'uploading') {
              job.pendingDigests = [...new Set(job.files.map((file) => file.digest))];
              job.uploaded = 0;
            } else fail('PROVIDER_RESPONSE', '部署文件状态暂未就绪。', 502);
          }
          await persist();
          const next = job.pendingDigests[0];
          if (next) {
            const file = job.files.find((f) => f.digest === next);
            if (!file) fail('PROVIDER_RESPONSE', '上传清单与构建产物不一致。', 502);
            await this.provider.upload(token, job.deployId, file);
            job.pendingDigests.shift();
          }
          job.uploaded = job.files.filter((file) => !job.pendingDigests.includes(file.digest)).length;
          job.phase = job.pendingDigests.length ? 'uploading' : 'waiting';
        }
      } else if (job.phase === 'access_unverified' && job.url) {
        // A ready deployment may still be private. Probe only the allowlisted
        // default host, without cookies/token; never follow redirects.
        try {
          job.error = '平台已部署，公网版本标记尚未核验；请稍后查询或检查 Netlify 访问保护。';
          const response = await this.fetchImpl(`${job.url}/_jingyue_release.txt`, {
            redirect: 'error',
            credentials: 'omit',
            signal: AbortSignal.timeout(8000),
          });
          if (response.ok && (await readLimited(response, 128)) === job.id) {
            // A reachable marker does not prove the actual entry page works.
            // No credentials, redirects, or arbitrary browser-supplied hosts.
            job.error = '公网版本标记已匹配，但网站首页尚不能正常匿名访问；请检查 Netlify 后继续查询。';
            const home = await this.fetchImpl(`${job.url}/`, {
              redirect: 'error',
              credentials: 'omit',
              signal: AbortSignal.timeout(8000),
            });
            if (
              home.ok &&
              /^text\/html(?:\s*;|$)/i.test(home.headers.get('content-type') || '') &&
              (await readLimited(home, 8 * 1024 * 1024)).trim()
            ) {
              job.phase = 'published';
              state.lastPublished = { url: job.url, revision: job.revision, at: Date.now() };
            } else await home.body?.cancel();
          } else await response.body?.cancel();
        } catch {
          /* Platform ready, but public access is not yet verified. */
        }
      }
      job.error = ['failed', 'access_unverified'].includes(job.phase) ? job.error : null;
      await save(state);
      return jobView(state);
    } catch (error) {
      if (state.job)
        state.job.error = error instanceof PublishingError ? error.message : '发布状态暂不可用，请重试查询。';
      await save(state);
      throw error;
    }
  }
  acceptSite(state, site) {
    if (!identifier(site.id) || site.name !== state.siteName || site.account_id !== state.team.id)
      fail('SITE_FORBIDDEN', '新站点的归属核验失败，未继续部署。', 403);
    state.siteId = site.id;
  }
  acceptDeploy(state, deploy) {
    if (!identifier(deploy.id) || deploy.site_id !== state.siteId) fail('PROVIDER_RESPONSE', '部署归属核验失败。', 502);
    state.job.deployId = deploy.id;
    state.job.phase = 'uploading';
    this.acceptManifest(state.job, deploy);
  }
  acceptManifest(job, deploy) {
    if (job.pendingDigests || ['new', 'pending', 'preparing'].includes(deploy.state)) return;
    if (!Array.isArray(deploy.required)) return;
    // Legacy jobs have already started uploading without saving the manifest.
    // An empty response is not proof that the remaining files were uploaded.
    if (job.uploaded > 0 && deploy.state === 'uploading') return;
    const known = new Set(job.files.map((file) => file.digest));
    if (deploy.required.some((digest) => !known.has(digest)))
      fail('PROVIDER_RESPONSE', '上传清单与构建产物不一致。', 502);
    job.pendingDigests = [...new Set(deploy.required)];
  }
}
