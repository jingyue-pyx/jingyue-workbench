import { describe, expect, it, vi } from 'vitest';
import type { Message } from 'ai';
import {
  explainLastFailure,
  isExplanationRequest,
  latestOutcome,
  outcomeAnnotation,
  routeConversation,
  requestsDesignReview,
  requestsExplicitRepair,
  conversationPrompt,
  requestsExplicitCreation,
  conversationFailureMessage,
  conversationDiagnostics,
} from './conversation';
import { RunError, type RunState } from './protocol';

const history: Message[] = [
  { id: 'create', role: 'user', content: '帮我生成营销后台', annotations: ['managed-run', 'managed-task'] },
  {
    id: 'failure',
    role: 'assistant',
    content: '未完成',
    annotations: ['managed-run', 'managed-outcome:failed:typechecking:compile:2'],
  },
];
const options = (request = vi.fn()) => ({ history, signal: new AbortController().signal, request });

describe('run-bound diagnosis context', () => {
  const state: RunState = {
    id: 'failure',
    phase: 'failed',
    detail: '类型检查失败',
    attempt: 2,
    maxRepairs: 2,
    events: [],
    changed: [],
    startedAt: 0,
    errors: ['older error', 'src/App.tsx(12,8): error TS2345: Argument type does not match.'],
  };
  it('supplies only the latest observed diagnostic and labels unpromoted source', () => {
    const [value] = conversationDiagnostics(history, state);
    expect(JSON.parse(value)).toMatchObject({ runId: 'failure', diagnostic: state.errors[1] });
    expect(value).toContain('unpromoted-candidate');
    expect(value).not.toContain('older error');
  });
  it('never attaches another run or a stale failure after a new outcome', () => {
    expect(conversationDiagnostics(history, { ...state, id: 'other-project-run' })).toEqual([]);
    expect(conversationDiagnostics(history, { ...state, phase: 'succeeded' })).toEqual([]);
    expect(conversationDiagnostics([], state)).toEqual([]);
    expect(
      conversationDiagnostics(
        [
          ...history,
          {
            id: 'newer',
            role: 'assistant',
            content: 'done',
            annotations: ['managed-outcome:succeeded:previewing:none:0'],
          },
        ],
        state,
      ),
    ).toEqual([]);
  });
  it('bounds and redacts the evidence without changing stored history', () => {
    const original = JSON.stringify(history);
    const [value] = conversationDiagnostics(history, {
      ...state,
      errors: ['x'.repeat(9000) + ' api_key=secret-value sk-12345678901234567890'],
    });
    expect(JSON.parse(value).diagnostic.length).toBeLessThanOrEqual(6000);
    expect(value).not.toContain('secret-value');
    expect(value).not.toContain('sk-12345678901234567890');
    expect(JSON.stringify(history)).toBe(original);
  });
  it('uses read-only diagnosis for candidate failures even with no live source', async () => {
    const request = vi.fn().mockResolvedValue('本轮候选 App.tsx 有类型错误，未写入当前工程。');
    const result = await routeConversation('为什么失败', {
      ...options(request),
      hasSources: false,
      hasDiagnostics: true,
    });
    expect(result).toHaveProperty('answer');
    expect(request).toHaveBeenCalledWith('answer', '为什么失败');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
describe('conversation intent boundary', () => {
  it.each([
    '继续再试试呢',
    '再试试',
    '再试一下嘛',
    '继续试一次',
    '请再重试一下',
    '继续生成',
    '继续执行',
    '重试上次任务',
  ])('resumes the failed creation with no files rather than classifying it as preview: %s', async (task) => {
    const request = vi.fn().mockResolvedValue('{"intent":"preview"}');
    const restored: Message[] = JSON.parse(
      JSON.stringify([
        { ...history[0], content: '帮我创建一个个人作品集，不编造奖项，按钮可以操作。' },
        { ...history[1], annotations: ['managed-outcome:failed:idle:sandbox:0'] },
        { id: 'current', role: 'user', content: task, annotations: ['managed-run'] },
      ]),
    );
    const result = await routeConversation(task, { ...options(request), history: restored, hasSources: false });
    expect(result).toEqual({
      task: expect.stringContaining('个人作品集，不编造奖项'),
      reviewPlan: false,
      resumeCandidate: true,
    });
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['继续排查', '继续排查一下这个问题', '你再分析一下呢', '继续解释', '接着看看原因'])(
    'continues investigation with context without starting code or preview: %s',
    async (task) => {
      const request = vi.fn().mockResolvedValue('上次停在运行环境启动，尚未写文件。');
      const result = await routeConversation(task, { ...options(request), hasSources: false });
      expect(result).toHaveProperty('answer');
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith('answer', task);
    },
  );
  it.each(['继续再试试呢', '继续执行', '继续修复'])('does not bypass a pending plan approval: %s', async (task) => {
    const result = await routeConversation(task, { ...options(), awaitingApproval: true });
    expect(result).toEqual({ answer: expect.stringContaining('等待确认') });
  });
  it('bare continue resumes only a known failed task, not a cancelled task or normal discussion', async () => {
    expect(await routeConversation('继续', options())).toHaveProperty('task');

    const cancelled: Message = {
      id: 'cancel',
      role: 'assistant',
      content: '停止',
      annotations: ['managed-outcome:cancelled:planning:none:0'],
    };
    expect(await routeConversation('继续', { ...options(), history: [...history, cancelled] })).toHaveProperty(
      'answer',
    );
    expect(await routeConversation('继续', { ...options(), history: [] })).toHaveProperty('answer');
    expect(
      await routeConversation('继续', {
        ...options(),
        history: [...history, { id: 'discussion', role: 'assistant', content: '接下来可以解释实现思路' }],
      }),
    ).toHaveProperty('answer');
  });
  it('keeps a restored design-first request behind plan review when explicitly retried', async () => {
    expect(
      await routeConversation('继续再试试呢', {
        ...options(),
        history: [{ ...history[0], content: '帮我设计一下个人作品集' }, history[1]],
      }),
    ).toEqual({ task: expect.stringContaining('个人作品集'), reviewPlan: true, resumeCandidate: true });
  });
  it.each(['不要重试，继续解释', '先不要修复，继续排查'])(
    'retains no-code restrictions on a follow-up: %s',
    async (task) => {
      const request = vi.fn().mockResolvedValue('只排查');
      expect(await routeConversation(task, options(request))).toEqual({ answer: '只排查' });
      expect(request).toHaveBeenCalledWith('answer', task);
    },
  );
  it.each(['“继续再试试呢”是什么意思', '如果再试试会怎样', '可以再试试吗？'])(
    'does not match a quote or hypothetical as deterministic retry: %s',
    async (task) => {
      const request = vi.fn().mockResolvedValue('{"intent":"answer","reply":"仅解释"}');
      expect(await routeConversation(task, options(request))).toHaveProperty('answer');
      expect(request).toHaveBeenCalled();
    },
  );
  it('does not invent a retry target when there is no confirmed task', async () => {
    expect(await routeConversation('继续再试试呢', { ...options(), history: [] })).toEqual({
      answer: expect.stringContaining('没有找到'),
    });
  });
  it('keeps a routing failure in the conversation without raw transport details', () => {
    const signal = new AbortController().signal;
    expect(conversationFailureMessage(new RunError('模型连接中断', false, 'network'), signal)).toContain(
      '模型连接中断',
    );
    expect(conversationFailureMessage(new Error('private transport diagnostic'), signal)).not.toContain('private');
    expect(conversationFailureMessage(new Error('transport failed'), signal)).toContain('尚未启动新的代码任务');
  });
  it('distinguishes routing timeout from user cancellation', () => {
    const timeout = new AbortController();
    timeout.abort(new Error('对话响应超时，尚未开始新的生成任务。'));
    expect(conversationFailureMessage(timeout.signal.reason, timeout.signal)).toContain('识别需求或回答问题时超时');

    const cancelled = new AbortController();
    cancelled.abort();
    expect(conversationFailureMessage(cancelled.signal.reason, cancelled.signal)).toBeUndefined();
  });
  it.each([
    '帮我创建一个登入合注册的页面要求注册的账号能够实际存储到数据库里面下一次登入不需要再次注册可以直接登入',
    '帮我生成一个营销页面',
    '创建一个不需要登录的产品展示页',
  ])('routes a new creation without asking for non-existent source: %s', async (task) => {
    const opts = { ...options(), history: [], hasSources: false };
    await expect(routeConversation(task, opts)).resolves.toEqual({ task, reviewPlan: false });
    expect(opts.request).not.toHaveBeenCalled();
  });
  it.each([
    '帮我创建一个登录页可以吗？',
    '帮我创建是什么意思',
    '如果帮我创建一个页面会怎样',
    '“帮我创建一个页面”是什么意思',
    '帮我创建一个登录页，但先不要动手',
    '帮我创建一个登录页，不需要写代码',
    '为什么创建失败',
    '生成的页面为什么这么丑',
    '创建失败了',
  ])('does not treat quoted, deferred or hypothetical creation as approval: %s', (task) => {
    expect(requestsExplicitCreation(task)).toBe(false);
  });
  it.each(['为什么点击体验demo之后就没有对应的功能页面了', '为什么按钮不显示', '为什么生成失败'])(
    'inspects current files rather than short-circuiting to an old outcome: %s',
    async (task) => {
      const opts = {
        ...options(vi.fn().mockResolvedValue('src/App.tsx 的 ExperienceButton 只调用 alert。')),
        hasSources: true,
      };
      await expect(routeConversation(task, opts)).resolves.toEqual({
        answer: 'src/App.tsx 的 ExperienceButton 只调用 alert。',
      });
      expect(opts.request).toHaveBeenCalledWith('answer', task);
    },
  );
  it.each(['修复体验按钮', '那你快点修复再验证的呀', '为什么点了没反应？帮我修复', '请定位并修复这个问题'])(
    'routes an explicit fix with the full reported issue, without replanning approval: %s',
    async (task) => {
      const opts = options();
      await expect(routeConversation(task, opts)).resolves.toEqual({ task, reviewPlan: false });
      expect(opts.request).not.toHaveBeenCalled();
    },
  );
  it.each([
    '为什么没有修复',
    '你自己不能读取吗',
    '能不能帮我修复？',
    '如果你帮我修复会怎样',
    '把按钮改成“帮我修复”',
    '请修复是什么意思',
    '不要修复，先解释',
    '请修复按钮，但先不要修改代码',
    '先分析，请修复按钮',
  ])('does not derive fix permission from questions, quoted text or no-code instructions: %s', (task) =>
    expect(requestsExplicitRepair(task)).toBe(false),
  );
  it.each(['intent', 'answer'] as const)(
    'instructs %s to inspect the supplied source instead of claiming no access',
    (phase) => {
      expect(conversationPrompt(phase)).toContain('input.files');
      expect(conversationPrompt(phase)).toContain('never ask the user to paste files already included');
      expect(conversationPrompt(phase)).toContain('does NOT prove buttons');
    },
  );
  it.each(['帮我设计一下营销页面', '先规划一下采购系统', '给我一个技术方案', '设计一个营销页'])(
    'reviews an explicit design request without a classifier call: %s',
    async (task) => {
      const opts = options();
      await expect(routeConversation(task, opts)).resolves.toEqual({ task, reviewPlan: true });
      expect(opts.request).not.toHaveBeenCalled();
    },
  );
  it.each([
    '帮我生成一个营销页面',
    '太丑了，优化布局和配色',
    '不用出方案，直接生成营销页',
    '把按钮文案改成“帮我设计一下”',
    '设计模式是什么',
    '帮我设计一下是什么意思',
    '“帮我设计一下”是什么意思',
  ])('does not make a design keyword inside other requests an approval trigger: %s', (task) => {
    expect(requestsDesignReview(task)).toBe(false);
  });
  it('keeps an explicit no-code discussion read only, even with design words', async () => {
    const task = '帮我设计一下，先讨论，不要生成';
    const opts = options(vi.fn().mockResolvedValue('方案讨论'));
    await expect(routeConversation(task, opts)).resolves.toEqual({ answer: '方案讨论' });
    expect(opts.request).toHaveBeenCalledWith('answer', task);
  });
  it('explains the latest no-op instead of repeating a stale failure or claiming verification', async () => {
    const opts = {
      ...options(),
      history: [
        ...history,
        {
          id: 'noop',
          role: 'assistant' as const,
          content: '没有修改源码',
          annotations: ['managed-run', 'managed-outcome:unchanged:generating:none:0'],
        },
      ],
    };
    expect(latestOutcome(opts.history)?.outcome).toBe('unchanged');

    const result = await routeConversation('为什么没有完成', opts);
    expect((result as { answer: string }).answer).toContain('没有提出代码改动');
    expect((result as { answer: string }).answer).not.toContain('检查已通过');
    expect(opts.request).not.toHaveBeenCalled();
  });
  it.each([
    '为什么没有完成页面准备',
    '为什么没完成',
    '请问为什么生成失败',
    '帮我解释一下为什么编译失败',
    'Why did it fail?',
  ])('answers failure without a plan or model call: %s', async (text) => {
    const opts = options();
    const result = await routeConversation(text, opts);
    expect(result).toHaveProperty('answer');
    expect((result as { answer: string }).answer).toContain('TypeScript');
    expect(opts.request).not.toHaveBeenCalled();
  });
  it.each(['npm run preview', '帮我运行 npm run preview', '重新检查预览', '重试预览'])(
    'routes an existing preview operation without planning: %s',
    async (text) => {
      const opts = options();
      await expect(routeConversation(text, opts)).resolves.toEqual({ action: 'preview' });
      expect(opts.request).not.toHaveBeenCalled();
    },
  );
  it('supports a classified restart request, without accepting arbitrary shell output', async () => {
    await expect(
      routeConversation('你可以帮我运行呀', options(vi.fn().mockResolvedValue('{"intent":"preview"}'))),
    ).resolves.toEqual({ action: 'preview' });
    await expect(
      routeConversation(
        '运行其他命令',
        options(vi.fn().mockResolvedValue('{"intent":"shell","command":"echo unsafe"}')),
      ),
    ).rejects.toThrow('未返回有效结果');
  });
  it('keeps a question about preview read-only', async () => {
    await expect(
      routeConversation('为什么运行 npm run preview？', options(vi.fn().mockResolvedValue('解释'))),
    ).resolves.toEqual({ answer: '解释' });
  });
  it.each(['先讨论一下怎么做，不要生成', '为什么要用 React', '不要修改，解释下流程'])(
    'keeps discussion read only: %s',
    async (text) => {
      const opts = options(vi.fn().mockResolvedValue('解释'));
      expect(isExplanationRequest(text)).toBe(true);
      await expect(routeConversation(text, opts)).resolves.toEqual({ answer: '解释' });
      expect(opts.request).toHaveBeenCalledWith('answer', text);
    },
  );
  it('uses only the current explicit task, not an old task from history', async () => {
    const opts = options(vi.fn().mockResolvedValue('{"intent":"task"}'));
    await expect(routeConversation('给表单加预算输入', opts)).resolves.toEqual({
      task: '给表单加预算输入',
      reviewPlan: false,
    });
  });
  it.each([
    '请只完善当前页面的演示说明，保留现有表单和布局：页头和方案区都显著标注“示例数据 · 本页面为本地规则演示，未调用真实营销服务，不构成效果承诺”。移除“确保CPL≤0元”和无依据的 CTR/ROI 数值或保证；策略改成明确的示例建议，不暗示真实 AI 推理。不要改预算、受众和生成/重置按钮的功能，也不要新增后端。',
    '请修改标题，不要修改预算字段。',
    '优化文案，不要重新生成整个页面。',
    'Update the title, do not change the budget field.',
  ])('classifies scoped constraints without suppressing the requested edit: %s', async (task) => {
    const opts = options(vi.fn().mockResolvedValue('{"intent":"task"}'));
    expect(isExplanationRequest(task)).toBe(false);
    await expect(routeConversation(task, opts)).resolves.toEqual({ task, reviewPlan: false });
    expect(opts.request).toHaveBeenCalledWith('intent', task);
  });
  it.each(['请修复提交按钮，不要修改预算字段。', '请修复表单，不要重新生成页面。'])(
    'retains explicit repair with a local preservation constraint: %s',
    (task) => {
      expect(requestsExplicitRepair(task)).toBe(true);
    },
  );
  it.each([
    '请修复按钮，但先不要修改代码',
    '优化布局，但不要实际执行。',
    '请修改标题，不要修改任何文件。',
    'Update the title, but do not change any code.',
    '不要改预算、受众和生成按钮，先只分析。',
  ])('keeps whole-task execution prohibitions read-only: %s', async (task) => {
    const opts = options(vi.fn().mockResolvedValue('只解释'));
    await expect(routeConversation(task, opts)).resolves.toEqual({ answer: '只解释' });
    expect(opts.request).toHaveBeenCalledWith('answer', task);
  });
  it('does not turn a clarification or greeting into a plan', async () => {
    await expect(
      routeConversation(
        '你好',
        options(vi.fn().mockResolvedValue('{"intent":"answer","reply":"你好，需要生成还是讨论？"}')),
      ),
    ).resolves.toHaveProperty('answer');
  });
  it('fails closed on malformed classification', async () => {
    await expect(routeConversation('改这个', options(vi.fn().mockResolvedValue('{}')))).rejects.toThrow('尚未修改文件');
  });
  it('explicit retry targets the earlier task, not the why question', async () => {
    const opts = options();
    opts.history = [...history, { id: 'why', role: 'user', content: '为什么失败', annotations: ['managed-run'] }];
    expect(await routeConversation('重试上次任务', opts)).toEqual({
      task: expect.stringContaining('帮我生成营销后台'),
      reviewPlan: false,
      resumeCandidate: true,
    });
    expect(opts.request).not.toHaveBeenCalled();
  });
  it('does not invent an old task or failure cause for legacy records', async () => {
    await expect(routeConversation('重试上次任务', { ...options(), history: [] })).resolves.toHaveProperty('answer');
    expect(explainLastFailure([])).toContain('没有保留具体失败阶段');
  });
  it('preserves the last failed outcome when an accidental plan is cancelled', () => {
    expect(
      latestOutcome([
        ...history,
        {
          id: 'cancel',
          role: 'assistant',
          content: '取消',
          annotations: ['managed-outcome:cancelled:reviewing:none:0'],
        },
      ])?.outcome,
    ).toBe('failed');
  });
  it('aborting intent cannot start a task', async () => {
    const abort = new AbortController();
    const opts = {
      ...options(
        vi.fn(async () => {
          abort.abort();
          return '{"intent":"task"}';
        }),
      ),
      signal: abort.signal,
    };
    await expect(routeConversation('把这个页面完善一下', opts)).rejects.toThrow();
  });
  it('persists finite metadata and strips raw logs', () => {
    const state = {
      phase: 'failed',
      attempt: 2,
      detail: 'TS2307 password=private-canary',
      errors: [],
      events: [{ phase: 'typechecking' }],
    } as unknown as RunState;
    expect(outcomeAnnotation(state)).toBe('managed-outcome:failed:typechecking:compile:2');
    expect(
      latestOutcome([
        { id: 'x', role: 'assistant', content: '', annotations: ['managed-outcome:failed:invalid:secret:2'] },
      ]),
    ).toBeUndefined();
  });
});
