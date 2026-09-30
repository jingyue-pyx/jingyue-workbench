import { describe, expect, it, vi } from 'vitest';
import { ManagedRunController, type RunAdapter } from './controller';
import { PlanReviewGate } from './plan-review';
import { formatTechnicalPlan, managedSystemPrompt, parsePlan, resolvePlanAnswers } from './protocol';

const draft = {
  goal: '营销工作台',
  steps: ['构建表单', '类型检查与预览'],
  supported: true,
  modules: [{ name: '营销表单', description: '输入预算并预览方案', scope: 'frontend' }],
  backendMode: 'mock',
  backendNotes: '仅模拟，无真实发送服务',
  dataStrategy: '页面状态，不跨设备持久化',
  questions: [
    {
      id: 'layout',
      title: '选择布局',
      options: [
        { id: 'dashboard', label: '数据看板', description: '多模块并排展示' },
        { id: 'wizard', label: '引导表单', description: '分步填写' },
      ],
    },
  ],
};

function runner(gate: PlanReviewGate, initial = { ...draft, questions: [] as typeof draft.questions }) {
  let files = {};
  const model = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify(initial))
    .mockResolvedValue(
      JSON.stringify({
        summary: '生成界面',
        files: [{ path: 'src/App.tsx', content: 'export default function App(){return <main>OK</main>}' }],
      }),
    );
  const adapter: RunAdapter = {
    capture: () => files,
    revision: () => 0,
    checkpoint: vi.fn().mockResolvedValue(undefined),
    model,
    review: (_plan, signal) => gate.wait('test', signal),
    apply: vi.fn(async (changes) => {
      files = { ...files, ...changes };
    }),
    verify: vi.fn().mockResolvedValue('https://example.test'),
    stop: vi.fn(),
    record: vi.fn().mockResolvedValue(undefined),
  };

  return { adapter, controller: new ManagedRunController(adapter, vi.fn()) };
}

describe('visible engineering plan and questions', () => {
  it('allows deferred steps only for a validated clarification draft, never a final executable plan', () => {
    expect(parsePlan(JSON.stringify({ ...draft, steps: [], modules: [] })).questions).toHaveLength(1);
    expect(() => parsePlan(JSON.stringify({ ...draft, steps: [], questions: [] }))).toThrow('执行步骤');
    expect(() => parsePlan(JSON.stringify({ ...draft, steps: [], questions: [{ id: 'invalid' }] }))).toThrow(
      '方案问题',
    );
  });
  it('uses a distinct finalization instruction rather than asking for another questionnaire', () => {
    expect(managedSystemPrompt('plan')).toContain('ask 1 to 3');
    expect(managedSystemPrompt('plan', true)).toContain('FINAL PLAN SYNTHESIS');
    expect(managedSystemPrompt('plan', true)).toContain('Return questions: [] unconditionally');
    expect(managedSystemPrompt('plan', true)).not.toContain('ask 1 to 3');
    expect(managedSystemPrompt('generate', true)).not.toContain('FINAL PLAN SYNTHESIS');
  });
  it('normalizes old plans and retains explicit module/data boundaries', () => {
    const plan = parsePlan(JSON.stringify(draft));
    expect(plan.modules[0].scope).toBe('frontend');
    expect(plan.acceptance).toContain('类型检查通过');
    expect(formatTechnicalPlan(plan)).toContain('不自动创建或部署业务后端');
    expect(formatTechnicalPlan(plan)).toContain('待选择的问题');
  });
  it('cannot claim a required backend is supported', () => {
    expect(parsePlan(JSON.stringify({ ...draft, backendMode: 'required' })).supported).toBe(false);
  });
  it('validates choice ids instead of accepting arbitrary hidden answers', () => {
    const plan = parsePlan(JSON.stringify(draft));
    expect(() => resolvePlanAnswers(plan, {})).toThrow('完成');
    expect(() => resolvePlanAnswers(plan, { layout: 'unknown' })).toThrow('失效');
    expect(() => resolvePlanAnswers(plan, { layout: 'wizard', extra: 'x' })).toThrow();
    expect(resolvePlanAnswers(plan, { layout: 'wizard' })[0].answer).toContain('引导表单');
  });
  it('rejects duplicate options and unbounded clarification', () => {
    expect(() => parsePlan(JSON.stringify({ ...draft, questions: Array(4).fill(draft.questions[0]) }))).toThrow();
    expect(() =>
      parsePlan(
        JSON.stringify({
          ...draft,
          questions: [{ ...draft.questions[0], options: Array(2).fill(draft.questions[0].options[0]) }],
        }),
      ),
    ).toThrow();
  });
  it('does not initialize files or invoke generation before explicit confirmation', async () => {
    const gate = new PlanReviewGate();
    const { controller, adapter } = runner(gate);
    const completed = controller.run('营销前端');
    await vi.waitFor(() => expect(controller.state.phase).toBe('reviewing'));
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.model).toHaveBeenCalledTimes(1);
    expect(gate.confirm('stale')).toBe(false);
    expect(gate.confirm('test')).toBe(true);
    expect(gate.confirm('test')).toBe(false);
    expect((await completed).phase).toBe('succeeded');
  });
  it('cancellation invalidates approval without writing any files', async () => {
    const gate = new PlanReviewGate();
    const { controller, adapter } = runner(gate);
    const completed = controller.run('营销前端');
    await vi.waitFor(() => expect(controller.state.phase).toBe('reviewing'));
    controller.cancel();
    expect((await completed).phase).toBe('cancelled');
    expect(gate.confirm('test')).toBe(false);
    expect(adapter.apply).not.toHaveBeenCalled();
  });
  it('adjusts the existing plan without stopping or writing until fresh approval', async () => {
    const gate = new PlanReviewGate();
    const { controller, adapter } = runner(gate);
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(JSON.stringify({ ...draft, questions: [] }))
      .mockResolvedValueOnce(JSON.stringify({ ...draft, questions: [], goal: '增加预算字段' }))
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: '修改表单',
          files: [{ path: 'src/App.tsx', content: 'export default function App(){return <main>预算</main>}' }],
        }),
      );

    const done = controller.run('营销页面');
    await vi.waitFor(() => expect(controller.state.phase).toBe('reviewing'));
    expect(() => gate.adjust('test', '   ')).toThrow();
    expect(gate.adjust('stale', '增加预算')).toBe(false);
    expect(gate.adjust('test', '增加预算')).toBe(true);
    expect(gate.confirm('test')).toBe(false);
    await vi.waitFor(() => expect(controller.state.plan?.goal).toBe('增加预算字段'));
    expect(controller.state.phase).toBe('reviewing');
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
    expect(vi.mocked(adapter.model).mock.calls[1][1].plan?.decisions?.[0].answer).toBe('增加预算');
    gate.confirm('test');
    expect((await done).phase).toBe('succeeded');
  });
  it('retains the old plan on refinement failure and allows another adjustment', async () => {
    const gate = new PlanReviewGate();
    const { controller, adapter } = runner(gate);
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(JSON.stringify({ ...draft, questions: [] }))
      .mockRejectedValueOnce(new Error('temporary transport failure'))
      .mockResolvedValueOnce(JSON.stringify({ ...draft, questions: [], goal: '新版方案' }));

    const done = controller.run('营销页面');
    await vi.waitFor(() => expect(controller.state.phase).toBe('reviewing'));
    gate.adjust('test', '修改布局');
    await vi.waitFor(() => expect(controller.state.reviewError).toContain('原方案'));
    expect(controller.state.phase).toBe('reviewing');
    expect(controller.state.plan?.goal).toBe(draft.goal);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
    gate.adjust('test', '重试修改布局');
    await vi.waitFor(() => expect(controller.state.plan?.goal).toBe('新版方案'));
    expect(controller.state.reviewError).toBeUndefined();
    controller.cancel();
    expect((await done).phase).toBe('cancelled');
  });
  it('updates the plan from selected answers and separately confirms before generation', async () => {
    const gate = new PlanReviewGate();
    const { controller, adapter } = runner(gate, draft);
    const model = vi.mocked(adapter.model);
    model
      .mockReset()
      .mockResolvedValueOnce(JSON.stringify(draft))
      .mockResolvedValueOnce(JSON.stringify({ ...draft, questions: [], goal: '分步营销表单' }))
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: '表单',
          files: [{ path: 'src/App.tsx', content: 'export default function App(){return <main>Form</main>}' }],
        }),
      );

    const completed = controller.run('营销前端');
    await vi.waitFor(() => expect(controller.state.phase).toBe('reviewing'));
    gate.confirm('test', { layout: 'wizard' });
    await vi.waitFor(() => expect(controller.state.plan?.goal).toBe('分步营销表单'));
    expect(controller.state.phase).toBe('reviewing');
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(model.mock.calls[1][1].plan?.decisions?.[0].answer).toContain('引导表单');
    gate.confirm('test');
    expect((await completed).phase).toBe('succeeded');
    expect(model.mock.calls[2][1].plan?.decisions?.[0].answer).toContain('引导表单');
    expect(model).toHaveBeenCalledTimes(3);
  });
  it('corrects repeated questions once while retaining selections and requiring fresh approval', async () => {
    const gate = new PlanReviewGate();
    const { controller, adapter } = runner(gate, draft);
    const model = vi.mocked(adapter.model);
    model
      .mockReset()
      .mockResolvedValueOnce(JSON.stringify(draft))
      .mockResolvedValueOnce(JSON.stringify(draft))
      .mockImplementationOnce(async (phase, payload) => {
        expect(phase).toBe('plan');
        expect(payload.errors.join(' ')).toContain('不要重复追问');
        expect(payload.plan?.decisions?.[0].answer).toContain('引导表单');
        expect(adapter.apply).not.toHaveBeenCalled();

        return JSON.stringify({ ...draft, questions: [], goal: '选择后的方案' });
      })
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: '生成',
          files: [{ path: 'src/App.tsx', content: 'export default function App(){return <main>Form</main>}' }],
        }),
      );

    const done = controller.run('营销页面');
    await vi.waitFor(() => expect(controller.state.phase).toBe('reviewing'));
    gate.confirm('test', { layout: 'wizard' });
    await vi.waitFor(() => expect(controller.state.plan?.goal).toBe('选择后的方案'));
    expect(controller.state.phase).toBe('reviewing');
    expect(adapter.apply).not.toHaveBeenCalled();
    gate.confirm('test');
    expect((await done).phase).toBe('succeeded');
    expect(model.mock.calls.map(([phase]) => phase)).toEqual(['plan', 'plan', 'plan', 'generate']);
  });
  it('keeps the previous plan after a refinement and its one correction both fail validation', async () => {
    const gate = new PlanReviewGate();
    const { controller, adapter } = runner(gate);
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(JSON.stringify({ ...draft, questions: [] }))
      .mockResolvedValue('{}');

    const done = controller.run('营销页面');
    await vi.waitFor(() => expect(controller.state.phase).toBe('reviewing'));
    gate.adjust('test', '增加预算');
    await vi.waitFor(() => expect(controller.state.reviewError).toContain('原方案'));
    expect(controller.state.plan?.goal).toBe(draft.goal);
    expect(adapter.model).toHaveBeenCalledTimes(3);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
    controller.cancel();
    expect((await done).phase).toBe('cancelled');
  });
});
