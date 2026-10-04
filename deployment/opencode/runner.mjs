import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, chmod, readdir, lstat, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AGENT_IMAGE,
  AGENT_VERSION,
  AgentError,
  agentConfig,
  changedFiles,
  sourcePath,
  taskPrompt,
  validateInput,
} from './protocol.mjs';
import { createServeClient } from './serve-client.mjs';
import { createAgentModelProxy } from './model-proxy.mjs';
import { hasCredentialLiteral } from '../scan.mjs';
import { missingStyleImports } from './styles.mjs';

const exec = promisify(execFile);
const docker = (args, options = {}) => exec('docker', args, { maxBuffer: 1024 * 1024, timeout: 180000, ...options });
const excluded = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.opencode', 'package-lock.json']);

export async function readCandidate(root) {
  const files = Object.create(null);
  let count = 0;
  let bytes = 0;
  const visit = async (relative = '') => {
    for (const name of await readdir(join(root, relative))) {
      if (excluded.has(name)) continue;
      const path = relative ? `${relative}/${name}` : name;
      const meta = await lstat(join(root, path));
      if (++count > 250 || meta.isSymbolicLink() || !sourcePath(path))
        throw new AgentError('AGENT_UNSAFE_OUTPUT', 'Agent 生成了不受支持的文件路径，候选未写入。');
      if (meta.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!meta.isFile() || meta.nlink !== 1 || meta.size > 1000000)
        throw new AgentError('AGENT_UNSAFE_OUTPUT', 'Agent 生成了不受支持的文件类型，候选未写入。');
      const raw = await readFile(join(root, path));
      bytes += raw.length;
      const content = raw.toString('utf8');
      if (bytes > 1024 * 1024 || content.length > 250000 || raw.includes(0) || hasCredentialLiteral(content, path))
        throw new AgentError('AGENT_UNSAFE_OUTPUT', 'Agent 输出超过范围或包含疑似凭据，候选未写入。');
      files[path] = content;
    }
  };
  await visit();
  return files;
}

// LOCAL EXPERIMENT ONLY. No Docker socket, repository root, SSH directory or
// cloud credentials are mounted. One ephemeral container per candidate run.
export async function createLocalOpenCode({ config, report = () => {}, transport }) {
  if (!config.localTest || config.host !== '127.0.0.1')
    throw new AgentError('AGENT_LOCAL_ONLY', 'OpenCode 试验仅允许在本机回环服务启用。');
  const proxy = await createAgentModelProxy({ config, report, transport });
  let active = false;
  const budgets = new Map();
  return {
    version: AGENT_VERSION,
    close: () => proxy.close(),
    async run(raw, { owner, signal, charge, progress = () => {} }) {
      const input = validateInput(raw);
      if (active) throw new AgentError('AGENT_BUSY', '另一个 OpenCode 任务正在运行，请稍后重试。', 429);
      active = true;
      const deadline = AbortSignal.timeout(7 * 60 * 1000);
      const abort = AbortSignal.any([signal, deadline]);
      const key = `${owner}:${input.runId}`;
      // Prevent a controller-level repair retry from resetting model budgets.
      for (const [id, budget] of budgets) if (Date.now() - budget.at > 30 * 60 * 1000) budgets.delete(id);
      const budget = budgets.get(key) || { calls: 0, reserved: 0, at: Date.now() };
      budgets.set(key, budget);
      const grant = proxy.issue({ signal: abort, model: input.model, charge, budget });
      const name = `jingyue-agent-${randomUUID()}`;
      let root;
      let client;
      let session;
      let events;
      const eventsAbort = new AbortController();
      try {
        progress({ type: 'progress', stage: 'starting' });
        root = await mkdtemp(join(tmpdir(), 'jingyue-opencode-'));
        const workspace = join(root, 'workspace');
        await mkdir(workspace);
        await chmod(root, 0o700);
        // Parent remains private on the host; Docker's unprivileged user can
        // write only the explicitly mounted candidate directory.
        await chmod(workspace, 0o777);
        for (const [path, content] of Object.entries(input.files)) {
          abort.throwIfAborted();
          await mkdir(dirname(join(workspace, path)), { recursive: true, mode: 0o777 });
          let parent = dirname(path);
          while (parent !== '.') {
            await chmod(join(workspace, parent), 0o777);
            parent = dirname(parent);
          }
          await writeFile(join(workspace, path), content, { mode: 0o666 });
          await chmod(join(workspace, path), 0o666);
        }
        const password = randomBytes(32).toString('hex');
        await writeFile(
          join(root, 'agent.env'),
          `OPENCODE_SERVER_PASSWORD=${password}\nOPENCODE_CONFIG_CONTENT=${JSON.stringify(
            agentConfig(`http://host.docker.internal:${proxy.port}/v1`, grant.token, input.model),
          )}\n`,
          { mode: 0o600 },
        );
        await docker(
          [
            'run',
            '--detach',
            '--name',
            name,
            '--init',
            '--cap-drop=ALL',
            '--security-opt=no-new-privileges',
            '--pids-limit=192',
            '--memory=2g',
            '--cpus=2',
            '--publish',
            '127.0.0.1::4096',
            '--mount',
            `type=bind,source=${workspace},target=/workspace`,
            '--env-file',
            join(root, 'agent.env'),
            AGENT_IMAGE,
          ],
          { signal: abort },
        );
        await unlink(join(root, 'agent.env'));
        const { stdout } = await docker(
          ['inspect', '--format', '{{(index (index .NetworkSettings.Ports "4096/tcp") 0).HostPort}}', name],
          { signal: abort },
        );
        if (!/^\d+$/.test(stdout.trim())) throw new AgentError('AGENT_START', '未获取到 OpenCode 本机端口。');
        client = createServeClient({ origin: `http://127.0.0.1:${stdout.trim()}`, password, report });
        let ready = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          abort.throwIfAborted();
          try {
            const health = await client.health(AbortSignal.any([abort, AbortSignal.timeout(2000)]));
            if (health.healthy && health.version === AGENT_VERSION) {
              ready = true;
              break;
            }
          } catch {
            /* Bounded cold start, never model retries. */
          }
          await delay(500, undefined, { signal: abort });
        }
        if (!ready) throw new AgentError('AGENT_START', 'OpenCode 容器启动超时，请确认本机 Docker 和测试镜像可用。');
        session = (await client.session(abort)).id;
        if (typeof session !== 'string' || !/^ses_[A-Za-z0-9]+$/.test(session))
          throw new AgentError('AGENT_SESSION', 'OpenCode 未返回有效会话。');
        events = client.events(session, AbortSignal.any([abort, eventsAbort.signal]), progress).catch(() => {});
        let prompt = taskPrompt(input);
        for (let repair = 0; repair <= 2; repair++) {
          progress({ type: 'progress', stage: repair ? 'repairing' : 'coding' });
          try {
            await client.prompt(session, input.model, prompt, abort);
          } catch (error) {
            if (!grant.stats.failure) throw error;
            const messages = {
              AGENT_BUDGET: 'OpenCode 本轮已达到调用预算，候选未写入；已有源码保留。',
              AGENT_QUOTA: '工作台模型调用额度或频率已达上限，候选未写入；请稍后继续。',
              AGENT_MODEL: 'OpenCode 连接模型服务失败，候选未写入；已有源码保留。',
            };
            throw new AgentError(grant.stats.failure, messages[grant.stats.failure]);
          }
          abort.throwIfAborted();
          if (grant.stats.failure)
            throw new AgentError(grant.stats.failure, 'OpenCode 的模型请求未完成或额度已用完；已有源码保留。');
          // Verify scripts/config before running them, not only after a
          // purported successful build. The agent cannot redefine success.
          // Freeze every container process while the host inspects the mount:
          // lstat/read checks alone are vulnerable to a symlink-swap race.
          await docker(['pause', name], { signal: abort });
          let failed;
          try {
            const candidate = await readCandidate(workspace);
            changedFiles(input.files, candidate);
            failed = missingStyleImports(candidate);
          } finally {
            await docker(['unpause', name], { timeout: 10000 });
          }
          // Agent statements are not proof of a passing build. Independently
          // execute the exact checks inside the same disposable container.
          if (!failed)
            for (const [stage, args] of [
              ['installing', ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund']],
              ['typechecking', ['npm', 'run', 'typecheck']],
              ['building', ['npm', 'run', 'build']],
            ]) {
              progress({ type: 'progress', stage });
              try {
                await docker(['exec', '--workdir', '/workspace', name, ...args], { signal: abort });
              } catch (error) {
                abort.throwIfAborted();
                if (error.killed || error.code === 'ETIMEDOUT')
                  throw new AgentError('AGENT_CHECK_TIMEOUT', 'OpenCode 候选检查超时，未切换当前工程。');
                failed = `${stage}\n${String(error.stdout || '').slice(-4000)}\n${String(error.stderr || '').slice(-2000)}`;
                break;
              }
            }
          if (!failed) {
            // No agent or background build process may mutate exported bytes.
            await docker(['stop', '--time', '3', name], { signal: abort, timeout: 15000 });
            const candidate = await readCandidate(workspace);
            const patch = changedFiles(input.files, candidate);
            report('opencode_candidate_checked');
            return {
              patch,
              checks: ['typecheck', 'build'],
              modelCalls: grant.stats.calls,
              engine: 'opencode',
              version: AGENT_VERSION,
            };
          }
          if (repair === 2)
            throw new AgentError('AGENT_CHECK_FAILED', 'OpenCode 候选未通过编译检查（已修复两轮），当前工程保留。');
          prompt = `平台独立检查未通过，请读取相关文件并修复，不删除功能或放宽检查配置。真实检查结果：\n${failed}`;
        }
      } catch (error) {
        if (signal.aborted) throw new AgentError('AGENT_CANCELLED', 'OpenCode 任务已取消，当前工程未改变。', 499);
        if (deadline.aborted) throw new AgentError('AGENT_TIMEOUT', 'OpenCode 任务达到时间上限，当前工程保留。', 504);
        if (error instanceof AgentError) throw error;
        throw new AgentError('AGENT_RUNTIME', 'OpenCode 运行环境失败，当前工程保留；请确认 Docker 已启动。');
      } finally {
        grant.revoke();
        eventsAbort.abort();
        if (client && session) await client.abort(session).catch(() => {});
        // Exact per-run name, never a broad prune or removal of user containers.
        await docker(['rm', '--force', name], { timeout: 15000 }).catch(() => {});
        if (root) await unlink(join(root, 'agent.env')).catch(() => {});
        await events;
        active = false;
      }
    },
  };
}
