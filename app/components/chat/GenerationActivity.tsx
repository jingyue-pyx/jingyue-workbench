import type { RunPhase } from '~/lib/runtime/managed/protocol';
import type { RunActivity } from '~/lib/runtime/managed/activity';

const labels: Partial<Record<RunPhase, string>> = {
  planning: '正在思考并整理方案',
  generating: '正在生成代码',
  repairing: '正在根据检查结果修复代码',
  applying: '正在写入项目文件',
  installing: '正在安装依赖',
  typechecking: '正在检查类型',
  building: '正在编译项目',
  starting: '正在启动预览',
  previewing: '正在连接并检查预览',
};

export function GenerationActivity({
  phase,
  activity,
  checkingRuntime = false,
}: {
  phase: RunPhase;
  activity: RunActivity;
  checkingRuntime?: boolean;
}) {
  const label = checkingRuntime && phase === 'planning' ? '正在检查浏览器运行环境，尚未开始写入代码' : labels[phase];

  if (!label) {
    return null;
  }

  const created = activity.files.filter((file) => file.kind === 'created').length;
  const updated = activity.files.length - created;
  const receiving = ['planning', 'generating', 'repairing'].includes(phase);

  return (
    <div className="mx-6 my-4 text-sm text-bolt-elements-textSecondary" aria-label="生成进度">
      <div role="status" aria-live="polite" className="flex items-center gap-2">
        <span aria-hidden className="i-svg-spinners:3-dots-fade text-bolt-elements-item-contentAccent" />
        <span>{label}…</span>
      </div>
      {receiving && activity.receivedChars > 0 && (
        <p className="mt-1 text-xs">已接收 {activity.receivedChars.toLocaleString()} 字符，完整检查后写入文件。</p>
      )}
      {activity.files.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer">
            已新增 {created} 个文件，更新 {updated} 个文件
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {activity.files.map((file) => (
              <li key={file.path} className="break-all">
                <span className="mr-2">{file.kind === 'created' ? '新增' : '更新'}</span>
                {file.path}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
