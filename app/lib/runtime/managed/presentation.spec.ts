import { describe, expect, it, vi, afterEach } from 'vitest';
import { runMessage, runtimeEvent, reportRepairCheck, reportRuntime } from './presentation';
import type { RunState } from './protocol';
import { BATCH_FAILURE_REASONS } from './batch-failure';
import { STOP_REASONS } from './stop-cause';
import { parseOutcomeAnnotation } from './outcome';

const failed: RunState = {
  id: 'fixture',
  phase: 'failed',
  detail: '任务规划格式无效 password=private-canary',
  attempt: 0,
  maxRepairs: 2,
  events: [{ phase: 'planning', detail: 'private-canary', at: 1 }],
  errors: ['private-canary'],
  changed: ['private-canary'],
  startedAt: 1,
};
afterEach(() => vi.unstubAllGlobals());
describe('runtime presentation and diagnostics', () => {
  it('retains repairs zero through six in saved results and rejects out-of-range attempts', () => {
    for (let attempt = 0; attempt <= 6; attempt++) {
      const state: RunState = {
        ...failed,
        attempt,
        maxRepairs: 6,
        detail: 'TS2305 private-canary',
        events: [{ phase: 'typechecking', detail: '', at: 1 }],
      };
      const event = runtimeEvent(state);
      expect(
        parseOutcomeAnnotation(`managed-outcome:${event.outcome}:${event.stage}:${event.reason}:${event.attempt}`),
      ).toMatchObject({ attempt, reasonCode: 'compile' });
      expect(runMessage(state)).not.toContain('private-canary');
    }

    for (const attempt of ['7', '8', '9', '10', '-1', '1.5', '06']) {
      expect(parseOutcomeAnnotation(`managed-outcome:failed:typechecking:compile:${attempt}`)).toBeUndefined();
    }
  });
  it('reports failed intermediate checks with finite metadata without leaking source or error text', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await reportRepairCheck({
        ...failed,
        detail: 'src/App.tsx TS2322 private-canary',
        events: [{ phase: 'typechecking', detail: 'private-canary', at: 1 }],
      });
      expect(warn).toHaveBeenCalledWith('jingyue_runtime_check', expect.stringContaining('"outcome":"retrying"'));
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-canary');
      expect(JSON.stringify(fetch.mock.calls)).not.toContain('private-canary');
      expect(JSON.stringify(fetch.mock.calls)).toContain('compile');
    } finally {
      warn.mockRestore();
    }
  });
  it.each(Object.entries(STOP_REASONS))('retains finite stop cause %s without raw diagnostics', (cause, reason) => {
    const state: RunState = {
      ...failed,
      phase: cause === 'task_timeout' ? 'failed' : 'cancelled',
      stopCause: cause as keyof typeof STOP_REASONS,
      failureCode: cause === 'task_timeout' ? cause : undefined,
    };
    expect(runMessage(state)).toContain(reason);
    expect(runMessage(state)).not.toContain('private-canary');

    const event = runtimeEvent(state);
    expect(event.reason).toBe(cause);
    expect(
      parseOutcomeAnnotation(`managed-outcome:${event.outcome}:${event.stage}:${event.reason}:${event.attempt}`)
        ?.reason,
    ).toBe(reason);
  });
  it('does not invent an explicit stop for older records without a cause', () => {
    const state = { ...failed, phase: 'cancelled' as const };
    expect(runMessage(state)).toContain('没有明确的停止原因');
    expect(runtimeEvent(state).reason).toBe('other');
  });
  it.each(Object.entries(BATCH_FAILURE_REASONS))('reports %s as a finite actionable batch reason', (code, reason) => {
    const state = { ...failed, detail: `文件批次校验仍未通过（${code}），private-canary` };
    expect(runMessage(state)).toContain(reason);
    expect(runMessage(state)).not.toContain('private-canary');
    expect(runtimeEvent(state).reason).toBe(code);
  });
  it('does not infer a subtype from old or forged batch diagnostics', () => {
    for (const detail of ['文件批次校验仍未通过', '文件批次校验仍未通过（private_canary）']) {
      expect(runtimeEvent({ ...failed, detail }).reason).toBe('model_output');
      expect(runMessage({ ...failed, detail })).not.toContain('private_canary');
    }
  });
  it('distinguishes a missing backend capability from login expiry or compile failure', () => {
    const state = { ...failed, detail: '当前能力不支持：真实账号登录认证尚未接入。' };
    expect(runMessage(state)).toContain('真实账号登录认证尚未接入');
    expect(runMessage(state)).toContain('尚未生成源码或执行编译');
    expect(runtimeEvent(state).reason).toBe('capability');
  });
  it('keeps the bounded OpenCode failure reason instead of a generic preparation failure', () => {
    const message = runMessage({ ...failed, detail: 'OpenCode 本轮已达到调用预算，候选未写入。' });
    expect(message).toContain('调用预算');
    expect(message).toContain('当前源码与预览保留');
    expect(message).not.toContain('未能完成页面准备');
  });
  it('does not ask the model to repair an incomplete dependency installation', () => {
    const state = {
      ...failed,
      detail: '依赖安装不完整',
      events: [{ phase: 'installing' as const, detail: '', at: 1 }],
    };
    expect(runMessage(state)).toContain('依赖包安装不完整');
    expect(runMessage(state)).toContain('不需要重新生成页面');
    expect(runtimeEvent(state).reason).toBe('dependency_install');
    expect(runMessage(state)).not.toMatch(/未能完成页面准备|自动修复尚未解决|已就绪/);
  });
  it('explains source drift without suggesting regeneration or disclosing source', () => {
    const state = { ...failed, detail: '当前源码版本已变化：src/private-canary.tsx' };
    expect(runMessage(state)).toContain('本轮候选没有覆盖最新内容');
    expect(runMessage(state)).not.toMatch(/private-canary|未能完成页面准备|已就绪/);
  });
  it('classifies preflight syntax failures without claiming that the candidate was committed', () => {
    const state = { ...failed, detail: '候选源码语法检查失败（src/private-canary.tsx:1:2）' };
    expect(runMessage(state)).toContain('当前工程未被这份候选覆盖');
    expect(runMessage(state)).not.toMatch(/private-canary|未能完成页面准备|已就绪/);
    expect(runtimeEvent(state).reason).toBe('compile');
  });
  it.each(['typechecking', 'building'] as const)(
    'identifies exhausted %s repairs without exposing source diagnostics',
    (stage) => {
      const state = { ...failed, detail: 'TS2304 private-canary', events: [{ phase: stage, detail: '', at: 1 }] };
      expect(runMessage(state)).toContain(stage === 'typechecking' ? 'TypeScript 类型检查' : '正式构建');
      expect(runMessage(state)).not.toMatch(/private-canary|未能完成页面准备|已就绪/);
    },
  );
  it.each(['typechecking', 'building'] as const)('does not turn a %s timeout into a source defect', (stage) => {
    const state = {
      ...failed,
      detail: '执行超时，已停止进程。 private-canary',
      events: [{ phase: stage, detail: '', at: 1 }],
    };
    expect(runMessage(state)).toContain('等待超时');
    expect(runMessage(state)).toContain('重新检查预览');
    expect(runMessage(state)).not.toMatch(/代码未通过|自动修复尚未解决|private-canary/);
    expect(runtimeEvent(state).reason).toBe('timeout');
  });
  it.each(['npm ERR! code E429 429 Too Many Requests registry', 'npm ERR! something failed in 429ms'])(
    'never calls package install failures model quota: %s',
    (detail) => {
      const state = { ...failed, detail, events: [{ phase: 'installing' as const, detail: '', at: 1 }] };
      expect(runMessage(state)).not.toContain('模型调用已达到');
      expect(runtimeEvent(state).reason).not.toBe('quota');
    },
  );
  it('still recognizes explicit model quota errors', () => {
    const state = { ...failed, detail: '模型额度或频率限制已触发，任务已停止。' };
    expect(runMessage(state)).toContain('模型调用已达到');
    expect(runtimeEvent(state).reason).toBe('quota');
  });
  it('explains install timeouts without asking the user to change the requirement', () => {
    const state = {
      ...failed,
      detail: '执行超时，已停止进程。 private-canary',
      events: [{ phase: 'installing' as const, detail: '', at: 1 }],
    };
    expect(runMessage(state)).toContain('依赖安装未完成');
    expect(runMessage(state)).toContain('重新检查预览');
    expect(runMessage(state)).not.toMatch(/可以重试或调整需求|private-canary|已就绪/);
  });
  it('explains a valid no-op without claiming a build or repair passed', () => {
    const state: RunState = {
      ...failed,
      phase: 'unchanged',
      detail: '入口在 /register，token=private-canary',
      events: [
        { phase: 'generating', detail: '', at: 1 },
        { phase: 'unchanged', detail: '', at: 2 },
      ],
    };
    expect(runMessage(state)).toContain('本轮没有修改源码');
    expect(runMessage(state)).toContain('/register');
    expect(runMessage(state)).toContain('尚未进行本轮编译');
    expect(runMessage(state)).not.toMatch(/代码生成未完成|预览已就绪|private-canary/);
    expect(runtimeEvent(state)).toEqual({ outcome: 'unchanged', stage: 'generating', reason: 'none', attempt: 0 });
  });
  it('distinguishes an unresolved no-op from incomplete output', () => {
    const state = { ...failed, detail: '模型未提供实际改动，当前任务或待修复问题仍未完成。' };
    expect(runtimeEvent(state).reason).toBe('model_no_change');
    expect(runMessage(state)).toContain('待修复问题仍未解决');
    expect(runMessage(state)).not.toContain('不完整内容');
  });
  it.each(['浏览器沙箱启动超时', '浏览器沙箱启动失败', '沙箱文件写入超时'])(
    'explains %s without blaming the task or API key',
    (detail) => {
      const state = { ...failed, detail, events: [{ phase: 'idle' as const, detail: '', at: 1 }] };
      expect(runtimeEvent(state).reason).toBe('sandbox');
      expect(runMessage(state)).not.toContain('可以重试或调整需求');
      expect(runMessage(state)).toMatch(/运行环境/);
      expect(runMessage(state)).not.toContain('private-canary');
    },
  );
  it('does not expose technical errors or claim a failed preview succeeded', () => {
    expect(runMessage(failed)).toContain('这一步还没完成');
    expect(runMessage(failed)).toContain('当前草稿已保留');
    expect(runMessage(failed)).toContain('继续提问');
    expect(runMessage(failed)).toContain('为什么没有完成？');
    expect(runMessage(failed)).not.toMatch(/规划格式|private-canary|已就绪/);
  });
  it('sends only finite diagnostic labels without project content', () => {
    expect(runtimeEvent(failed)).toEqual({ outcome: 'failed', stage: 'planning', reason: 'plan_format', attempt: 0 });
    expect(JSON.stringify(runtimeEvent(failed))).not.toContain('private-canary');
  });
  it('distinguishes a built app from an unverified preview connection', () => {
    const message = runMessage({
      ...failed,
      detail: '预览连接检查超时',
      events: [{ phase: 'previewing', detail: '', at: 1 }],
    });
    expect(message).toContain('通过构建');
    expect(message).toContain('尚未确认页面可用');
    expect(message).not.toContain('预览已就绪');
  });
  it('logging failures do not reject the task result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(reportRuntime(failed)).resolves.toBeUndefined();
  });
  it('does not misattribute a later model outage to earlier repaired styling errors', () => {
    const state = {
      ...failed,
      detail: '模型连接中断',
      errors: ['样式依赖缺失'],
      events: [{ phase: 'repairing' as const, detail: '', at: 1 }],
    };
    expect(runtimeEvent(state).reason).toBe('model_service');
    expect(runMessage(state)).toContain('模型服务连接');
  });
  it('reports rejected exact edits without exposing source or blaming preview', () => {
    const state = {
      ...failed,
      detail: '局部修改未能唯一匹配文件 src/private-canary.tsx',
      events: [{ phase: 'repairing' as const, detail: '', at: 1 }],
    };
    expect(runtimeEvent(state).reason).toBe('model_output');
    expect(runMessage(state)).toContain('本轮候选内容未写入');
    expect(runMessage(state)).toContain('不是预览连接故障');
    expect(runMessage(state)).not.toMatch(/private-canary|已就绪|未能完成页面准备/);
  });
  it('does not claim a compiler-rejected staged candidate was written into the live project', () => {
    const state = {
      ...failed,
      candidatePending: true,
      detail: 'TS2322',
      events: [{ phase: 'typechecking' as const, detail: '', at: 1 }],
    };
    expect(runMessage(state)).toContain('当前源码和原预览未被替换');
    expect(runMessage(state)).not.toContain('已写入的草稿');
    expect(runtimeEvent(state).reason).toBe('compile');
  });
  it.each([
    ['模型输出未完整结束', 'model_output', '代码生成未完成'],
    ['样式依赖缺失', 'style', '页面样式未准备完整'],
  ])('reports a safe actionable category for %s', (detail, reason, copy) => {
    const state = { ...failed, detail, errors: [], events: [{ phase: 'generating' as const, detail: '', at: 1 }] };
    expect(runtimeEvent(state).reason).toBe(reason);
    expect(runMessage(state)).toContain(copy);
    expect(runMessage(state)).not.toContain('private-canary');
  });
});
