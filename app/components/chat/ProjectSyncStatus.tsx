import { useStore } from '@nanostores/react';
import { useState, useEffect } from 'react';
import { chatId, readProject } from '~/lib/persistence/useChatHistory';
import { projectPersistence } from '~/lib/stores/project-persistence';
import { activeProjectState, projects } from '~/lib/persistence/projects';
import { isProjectId } from '~/lib/persistence/project-document';
import { projectCache } from '~/lib/persistence/project-cache';
import { visibleProjectRetry } from '~/lib/persistence/project-retry';

export function ProjectSyncStatus() {
  const id = useStore(chatId);
  const state = useStore(projectPersistence);
  const project = useStore(activeProjectState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!project || project.state !== 'local' || !project.retryable) return;
    return visibleProjectRetry(
      async () => {
        const latest = await projects.local(project.projectId);
        if (!latest || latest.state !== 'local' || !latest.retryable) return false;
        const result = await projects.save(latest.projectId, latest.document);
        return result.state === 'local' && !!result.retryable;
      },
      {
        isVisible: () => document.visibilityState === 'visible',
        subscribe: (listener) => {
          document.addEventListener('visibilitychange', listener);
          return () => document.removeEventListener('visibilitychange', listener);
        },
      },
    );
  }, [project?.projectId, project?.state, project?.retryable, project?.pending?.requestId]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const legacy = !!id && !isProjectId(id);
  const status =
    state === 'error'
      ? '保存或载入失败，请勿关闭页面；请导出项目备份。'
      : state === 'saving'
        ? '正在保存项目…'
        : legacy
          ? '旧项目仅保存在本机，尚未上传云端。'
          : project?.state === 'cloud'
            ? '云端已保存 · 包含对话与已保存源码，不含未保存的代码'
            : project?.state === 'conflict'
              ? '云端版本有冲突。本机修改已保留，不会自动覆盖云端。'
              : project?.state === 'deleted'
                ? '项目已删除，不会自动恢复。'
                : project?.state === 'local'
                  ? '仅本机草稿 · 尚未获得云端保存确认'
                  : '新项目默认云同步；云服务不可用时保存本机草稿。';
  return (
    <section
      className="px-4 py-2 text-xs border-b border-bolt-elements-borderColor text-bolt-elements-textSecondary"
      aria-label="项目保存状态"
    >
      <p role="status">{status}</p>
      {project?.error && <p>{project.error}</p>}
      {project?.state === 'local' && project.retryable && (
        <p>云数据库可能正在唤醒：本页可见时最多退避重试 5 次，仍失败可手动重试。</p>
      )}
      <div className="flex gap-3 mt-1 flex-wrap">
        {legacy && (
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (
                  !window.confirm(
                    '仅迁移当前旧项目：上传对话和已保存源码，排除 .env、.git、node_modules，不上传设置或密钥。旧项目仍保留在本机。继续？',
                  )
                )
                  return;
                const existing = await projectCache.meta(`migration:${id}`);
                let target = existing;
                if (!target) {
                  const migrated = await projects.create(await readProject(id!), {
                    sourceId: await projects.migrationSource(),
                    legacyId: id!,
                  });
                  target = migrated.projectId;
                  await projectCache.meta(`migration:${id}`, target);
                }
                window.location.href = `/chat/${target}`;
              })
            }
          >
            将这个旧项目迁移到云端
          </button>
        )}
        {project?.state === 'local' && (
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await projects.save(project.projectId, project.document);
              })
            }
          >
            重试云同步
          </button>
        )}
        {project?.state === 'conflict' && (
          <>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (
                    !window.confirm(
                      '载入云端会替换当前本机草稿。要保留本机修改，请先选择“复制本机为新项目”。继续载入云端？',
                    )
                  )
                    return;
                  await projects.load(project.projectId, true);
                  window.location.reload();
                })
              }
            >
              载入云端版本
            </button>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const copy = await projects.copy(project.projectId);
                  window.location.href = `/chat/${copy.projectId}`;
                })
              }
            >
              复制本机为新项目
            </button>
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
