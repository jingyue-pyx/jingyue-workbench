// Finite host-assigned causes. Never persist arbitrary cancellation messages.
export const STOP_REASONS = {
  user_stop: '收到明确的停止操作，本次任务已停止',
  page_left: '工作台页面离开或切换，当前浏览器任务已中断',
  manual_edit: '检测到手动编辑，为避免覆盖内容已停止自动修改',
  superseded: '新的需求替代了待确认方案，旧任务已停止',
  task_timeout: '任务达到执行时间上限，系统已中断等待；这不是主动取消',
} as const;
export type StopCause = keyof typeof STOP_REASONS;

export function stopReason(cause?: string) {
  return cause && Object.hasOwn(STOP_REASONS, cause) ? STOP_REASONS[cause as StopCause] : undefined;
}
