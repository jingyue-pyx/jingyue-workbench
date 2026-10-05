import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useStore } from '@nanostores/react';
import { activeProjectState } from '~/lib/persistence/projects';
import { workbenchStore } from '~/lib/stores/workbench';
import { streamingState } from '~/lib/stores/streaming';
import { webcontainer } from '~/lib/webcontainer';
import { buildPublishArtifacts } from '~/lib/publishing/build';
import { publishingDelay, publishingReady } from '~/lib/publishing/polling';
import { NetlifyAuthorization } from './NetlifyAuthorization';
import {
  publishRequest,
  PUBLISH_PHASES,
  type PublishingStatus,
  type PublishingTeam,
  type PublishJob,
} from '~/lib/publishing/client';

const button =
  'px-3 py-2 rounded-lg border border-bolt-elements-borderColor text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-bolt-elements-item-backgroundActive';

export function PublishingDialog() {
  const project = useStore(activeProjectState);
  const streaming = useStore(streamingState);
  const unsaved = useStore(workbenchStore.unsavedFiles);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PublishingStatus>();
  const [teams, setTeams] = useState<PublishingTeam[]>([]);
  const [teamId, setTeamId] = useState('');
  const [job, setJob] = useState<PublishJob>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dialogEpoch = useRef(0);
  const publicCheckAt = useRef(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const controller = useRef<AbortController>();
  const selectedProject = useRef(project?.projectId);
  selectedProject.current = project?.projectId;

  async function load() {
    const abort = new AbortController();
    controller.current = abort;

    const id = project?.projectId;
    const result = await publishRequest<PublishingStatus>(undefined, { signal: abort.signal });
    abort.signal.throwIfAborted();
    setStatus(result);

    if (result.connected) {
      const { teams: available } = await publishRequest<{ teams: PublishingTeam[] }>(
        { action: 'teams' },
        { signal: abort.signal },
      );
      abort.signal.throwIfAborted();
      setTeams(available);
      setTeamId((id) => (available.some((t) => t.id === id) ? id : available[0]?.id || ''));
    }

    if (project?.state === 'cloud' && result.enabled) {
      const current = await publishRequest<PublishJob>({ action: 'job', projectId: id }, { signal: abort.signal });
      abort.signal.throwIfAborted();

      if (selectedProject.current === id) {
        setJob(current);
      }
    }
  }

  const action = async (run: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }

    busyRef.current = true;

    const epoch = dialogEpoch.current;
    setBusy(true);
    setError('');

    try {
      await run();
    } catch (cause) {
      if (epoch !== dialogEpoch.current) {
        return;
      }

      if (cause && typeof cause === 'object' && 'name' in cause && cause.name === 'AbortError') {
        setMessage('已停止本机后续操作；已提交的远端发布未删除，可以稍后继续查询。');
      } else {
        setError(cause instanceof Error ? cause.message : '请求失败，请重新查询。');
      }
    } finally {
      if (epoch === dialogEpoch.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    dialogEpoch.current++;
    busyRef.current = false;
    setBusy(false);

    if (open) {
      setStatus(undefined);
      setTeams([]);
      setJob(undefined);
      setMessage('');
      setConfirmed(false);
      void action(load);
    }

    return () => controller.current?.abort();
  }, [open, project?.projectId]);

  const advance = async (id: string, signal: AbortSignal) => {
    let checkedPublicAccess = false;

    for (let count = 0; count < 320; count++) {
      signal.throwIfAborted();

      if (selectedProject.current !== id) {
        throw new Error('项目已切换，已停止推进。');
      }

      const next = await publishRequest<PublishJob>({ action: 'advance', projectId: id }, { signal });
      signal.throwIfAborted();

      if (selectedProject.current !== id) {
        throw new Error('项目已切换，已停止推进。');
      }

      setJob(next);

      if (['published', 'failed'].includes(next.phase)) {
        return;
      }

      if (next.phase === 'access_unverified') {
        if (checkedPublicAccess) {
          return;
        }

        checkedPublicAccess = true;
      }

      await publishingDelay(1500, signal);
    }
    setMessage('已暂停自动查询，请稍后点击继续查询。');
  };

  /*
   * Returning from the official settings page only verifies the existing job.
   * It must never create a site, rebuild, or weaken access protection itself.
   */
  useEffect(() => {
    if (!open || !status?.connected || job?.phase !== 'access_unverified' || !project?.projectId) {
      return undefined;
    }

    const id = project.projectId;
    const recheck = () => {
      if (document.hidden || busyRef.current || Date.now() - publicCheckAt.current < 5000) {
        return;
      }

      publicCheckAt.current = Date.now();
      void action(async () => {
        const abort = new AbortController();
        controller.current = abort;
        setMessage('正在复查已有站点的公网访问，不重新构建或创建网站。');
        await advance(id, abort.signal);
      });
    };
    window.addEventListener('focus', recheck);
    window.addEventListener('online', recheck);
    document.addEventListener('visibilitychange', recheck);

    return () => {
      window.removeEventListener('focus', recheck);
      window.removeEventListener('online', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [open, status?.connected, job?.phase, project?.projectId]);

  const publish = async () => {
    if (
      !project?.document.snapshot ||
      project.state !== 'cloud' ||
      !confirmed ||
      !teamId ||
      unsaved.size ||
      streaming
    ) {
      throw new Error('请先保存项目、等待生成完成，再确认公开发布。');
    }

    const frozen = structuredClone(project);
    const abort = new AbortController();
    controller.current = abort;

    const epoch = dialogEpoch.current;
    const container = await publishingReady(webcontainer, abort.signal);
    const files = await buildPublishArtifacts(container, frozen.document.snapshot!, abort.signal, (text) => {
      if (!abort.signal.aborted && epoch === dialogEpoch.current && selectedProject.current === frozen.projectId) {
        setMessage(text);
      }
    });
    abort.signal.throwIfAborted();

    const current = activeProjectState.get();

    if (
      current?.projectId !== frozen.projectId ||
      current.revision !== frozen.revision ||
      current.state !== 'cloud' ||
      workbenchStore.unsavedFiles.get().size
    ) {
      throw new Error('构建期间源码发生变化，请重新构建当前已保存版本。');
    }

    const result = await publishRequest<PublishJob>(
      {
        action: 'prepare',
        projectId: frozen.projectId,
        requestId: crypto.randomUUID(),
        revision: frozen.revision,
        teamId,
        files,
        confirmPublic: true,
      },
      { signal: abort.signal },
    );
    setJob(result);
    setMessage('构建完成，正在发布；关闭弹窗只停止后续推进，不会删除已提交的网站。');
    await advance(frozen.projectId, abort.signal);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={`${button} mr-2`} disabled={streaming}>
        发布网站
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[9999] bg-black/50" />
        <Dialog.Content className="fixed z-[10000] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,540px)] max-h-[85vh] overflow-auto rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary shadow-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-xl font-semibold">发布到你的 Netlify</Dialog.Title>
            <Dialog.Close className={button} aria-label="关闭发布窗口">
              关闭
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-bolt-elements-textSecondary leading-relaxed">
            发布已保存的 React + Vite 静态网页。资源归你选择的 Netlify 团队，鲸月不会获取你的登录密码，不会购买套餐。
          </Dialog.Description>
          <NetlifyAuthorization status={status} busy={busy} run={action} refresh={load} onMessage={setMessage} />
          {status?.enabled && status.connected && (
            <div className="space-y-4">
              <label className="block text-sm space-y-2">
                <span>网站所属团队</span>
                <select
                  className="block w-full p-2 rounded-lg bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor"
                  value={teamId}
                  disabled={busy}
                  onChange={(event) => setTeamId(event.target.value)}
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm text-bolt-elements-textSecondary">
                {project?.state === 'cloud' ? `当前已保存版本：${project.revision}` : '请先打开并保存一个项目。'}{' '}
                同一项目会更新原站点，不会每次新建。
              </p>
              <label className="flex items-start gap-2 text-sm leading-relaxed">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  确认内容可以公开，使用所选团队的套餐与额度；独立后端、工作台预览专用云存储不在本次发布范围。
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className={`${button} bg-purple-500 text-white`}
                  disabled={
                    busy ||
                    !confirmed ||
                    !teamId ||
                    project?.state !== 'cloud' ||
                    !project.document.snapshot ||
                    !!unsaved.size ||
                    streaming ||
                    (!!job && !['idle', 'published', 'access_unverified', 'failed'].includes(job.phase))
                  }
                  onClick={() => void action(publish)}
                >
                  构建并发布已保存版本
                </button>
                {job?.id && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        if (!project) {
                          return;
                        }

                        const abort = new AbortController();
                        controller.current = abort;
                        await advance(project.projectId, abort.signal);
                      })
                    }
                  >
                    继续查询 / 推进发布
                  </button>
                )}
                {busy && controller.current && (
                  <button
                    className={button}
                    onClick={() => {
                      controller.current?.abort();
                      setMessage('已请求停止本机后续操作；远端已提交的操作可能仍会完成，请稍后查询。');
                    }}
                  >
                    停止本机操作
                  </button>
                )}
              </div>
            </div>
          )}
          {job && (
            <div className="rounded-lg p-3 bg-bolt-elements-background-depth-2 text-sm space-y-2" role="status">
              <p>{PUBLISH_PHASES[job.phase] || '正在查询状态'}</p>
              {job.error && <p>{job.error}</p>}
              {job.phase === 'uploading' && (
                <p>
                  已提交 {job.uploaded || 0} / {job.fileCount} 个文件
                </p>
              )}
              {job.url && (
                <a className="text-purple-500 underline" href={job.url} target="_blank" rel="noopener noreferrer">
                  打开网站 ↗
                </a>
              )}
              {job.phase === 'access_unverified' && (
                <p>
                  Netlify 可能将新站点默认设为私有。请在项目概览核对访问保护；若需要公开，确认内容后再设为公开，
                  返回鲸月后会自动复查；也可点击“继续查询 / 推进发布”。鲸月不会自动关闭访问保护，也不需要重复构建。
                  {job.manageUrl && (
                    <a
                      className="ml-1 text-purple-500 underline"
                      href={job.manageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      打开 Netlify 项目设置 ↗
                    </a>
                  )}
                </p>
              )}
              {job.lastPublished && <p>上次验证通过：版本 {job.lastPublished.revision}</p>}
            </div>
          )}
          {message && (
            <p className="text-sm text-bolt-elements-textSecondary" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="text-sm text-red-500" role="alert">
              {error}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
