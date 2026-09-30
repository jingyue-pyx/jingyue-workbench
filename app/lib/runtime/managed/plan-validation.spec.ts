import { describe, expect, it, vi } from 'vitest';
import { ManagedRunController, type RunAdapter } from './controller';
import { parsePlan, PlanValidationError, RunError, type SourceFiles } from './protocol';
import { REACT_VITE_TEMPLATE } from './template';

const valid = { goal: '营销页面', supported: true, steps: ['实现预算表单', '验证交互'] };
const validText = JSON.stringify(valid);
const question = {
  id: 'layout',
  title: '选择布局',
  options: [
    { id: 'a', label: '看板', description: '并排展示' },
    { id: 'b', label: '表单', description: '分步填写' },
  ],
};

describe('plan JSON and schema validation', () => {
  it.each(['null', '[]', '"text"', '42', '{"goal":', `${validText}\n额外说明`, `说明\n${validText}`])(
    'rejects incomplete or non-object output without guessing: %s',
    (text) => {
      expect(() => parsePlan(text)).toThrow(PlanValidationError);
    },
  );
  it('accepts one complete JSON fence and normalizes supported legacy optional fields', () => {
    const plan = parsePlan(`\n\`\`\`json\n${validText}\n\`\`\`\n`);
    expect(plan.goal).toBe(valid.goal);
    expect(plan.modules).toHaveLength(2);
    expect(plan.questions).toEqual([]);
  });
  it.each([
    [{ ...valid, goal: '  ' }, 'goal'],
    [{ ...valid, supported: 'false' }, 'supported'],
    [{ ...valid, supported: null }, 'supported'],
    [{ ...valid, steps: [] }, 'steps'],
    [{ ...valid, steps: undefined }, 'steps'],
    [{ ...valid, steps: [{ title: '构建页面' }] }, 'steps.[0]'],
    [{ ...valid, steps: ['  '] }, 'steps.[0]'],
    [{ ...valid, modules: [] }, 'modules'],
    [{ ...valid, modules: [{ name: 'x', description: 'x', scope: 'backend' }] }, 'modules.[0].scope'],
    [{ ...valid, backendMode: 'java' }, 'backendMode'],
    [{ ...valid, acceptance: 'compile' }, 'acceptance'],
    [{ ...valid, questions: [question, question] }, 'questions'],
    [
      { ...valid, questions: [{ ...question, options: [question.options[0], question.options[0]] }] },
      'questions.[0].options',
    ],
  ])('reports the invalid field without silently coercing it', (value, path) => {
    try {
      parsePlan(JSON.stringify(value));
      expect.fail('must reject');
    } catch (error) {
      expect(error).toBeInstanceOf(PlanValidationError);
      expect((error as PlanValidationError).issues.join(' ')).toContain(path);
      expect((error as PlanValidationError).category).toBe('plan-format');
    }
  });
  it('preserves an unsupported backend boundary instead of fixing it into an allowed task', () => {
    expect(parsePlan(JSON.stringify({ ...valid, backendMode: 'required' })).supported).toBe(false);
    expect(parsePlan(JSON.stringify({ ...valid, supported: false })).supported).toBe(false);
  });
  it('allows deferred clarification details but rejects repeated questions at finalization', () => {
    const text = JSON.stringify({ ...valid, steps: [], modules: [], questions: [question] });
    expect(parsePlan(text).questions).toHaveLength(1);
    expect(() => parsePlan(text, { finalizing: true })).toThrow('不要重复追问');
  });
  it('bounds plan size and strips unsolicited files and decisions', () => {
    expect(() => parsePlan(' '.repeat(64001))).toThrow('长度上限');

    const plan = parsePlan(
      JSON.stringify({ ...valid, files: ['do not execute'], decisions: [{ answer: 'fake consent' }] }),
    );
    expect(plan).not.toHaveProperty('files');
    expect(plan).not.toHaveProperty('decisions');
  });
  it('does not leak invalid values into feedback or the displayed error', () => {
    try {
      parsePlan(JSON.stringify({ ...valid, backendMode: 'password=private-canary', goal: 'x'.repeat(501) }));
      expect.fail('must reject');
    } catch (error) {
      expect((error as Error).message).toContain('backendMode');
      expect((error as Error).message).not.toMatch(/private-canary|password|x{20}/);
    }
  });
});

function fixture() {
  let files: SourceFiles = { ...REACT_VITE_TEMPLATE };
  const adapter: RunAdapter = {
    capture: () => files,
    revision: () => 0,
    checkpoint: vi.fn().mockResolvedValue(undefined),
    model: vi.fn(),
    apply: vi.fn(async (changes) => {
      files = { ...files, ...changes };
    }),
    verify: vi.fn().mockResolvedValue('https://example.test'),
    stop: vi.fn(),
    record: vi.fn().mockResolvedValue(undefined),
  };
  const publish = vi.fn();

  return {
    adapter,
    controller: new ManagedRunController(adapter, publish),
    publish,
    setFiles: (next: SourceFiles) => {
      files = next;
    },
  };
}

const patch = JSON.stringify({
  summary: '改进表单',
  files: [{ path: 'src/App.tsx', content: 'export default function App(){return <main>预算</main>}' }],
});

describe('bounded plan correction before writing', () => {
  it('corrects once with field feedback, then still requires approval and normal verification', async () => {
    const { adapter, controller, publish } = fixture();
    vi.mocked(adapter.model)
      .mockResolvedValueOnce(JSON.stringify({ ...valid, steps: [{ title: 'bad' }] }))
      .mockImplementationOnce(async (phase, payload) => {
        expect(phase).toBe('plan');
        expect(payload.errors.join(' ')).toContain('steps.[0]');
        expect(payload.files).toEqual(REACT_VITE_TEMPLATE);
        expect(adapter.apply).not.toHaveBeenCalled();
        expect(adapter.checkpoint).not.toHaveBeenCalled();

        return validText;
      })
      .mockResolvedValueOnce(patch);
    adapter.review = vi.fn(async () => {
      expect(adapter.apply).not.toHaveBeenCalled();
      return { kind: 'confirm' as const };
    });
    expect((await controller.run('设计营销页面')).phase).toBe('succeeded');
    expect(vi.mocked(adapter.model).mock.calls.map(([phase]) => phase)).toEqual(['plan', 'plan', 'generate']);
    expect(adapter.review).toHaveBeenCalledOnce();
    expect(adapter.apply).toHaveBeenCalledOnce();
    expect(adapter.verify).toHaveBeenCalledOnce();
    expect(publish.mock.calls.some(([state]) => state.detail.includes('自动纠正 1/1'))).toBe(true);
  });
  it('stops after one correction and leaves existing sources and preview intact', async () => {
    const { adapter, controller } = fixture();
    vi.mocked(adapter.model).mockResolvedValue('{"goal":');

    const result = await controller.run('制作页面');
    expect(result.phase).toBe('failed');
    expect(result.detail).toContain('已自动纠正 1 次');
    expect(adapter.model).toHaveBeenCalledTimes(2);
    expect(adapter.capture()).toEqual(REACT_VITE_TEMPLATE);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.checkpoint).not.toHaveBeenCalled();
    expect(adapter.verify).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
  });
  it.each(['模型额度或频率限制已触发', '登录已失效', '模型连接中断'])('does not retry %s', async (message) => {
    const { adapter, controller } = fixture();
    vi.mocked(adapter.model).mockRejectedValue(new RunError(message));
    expect((await controller.run('页面')).detail).toBe(message);
    expect(adapter.model).toHaveBeenCalledOnce();
    expect(adapter.apply).not.toHaveBeenCalled();
  });
  it('does not bypass quota when a correction request itself is denied', async () => {
    const { adapter, controller } = fixture();
    vi.mocked(adapter.model).mockResolvedValueOnce('{}').mockRejectedValueOnce(new RunError('模型额度已用完'));
    expect((await controller.run('页面')).detail).toBe('模型额度已用完');
    expect(adapter.model).toHaveBeenCalledTimes(2);
    expect(adapter.apply).not.toHaveBeenCalled();
  });
  it('can retry a known length truncation, without accepting partial plans', async () => {
    const { adapter, controller } = fixture();
    vi.mocked(adapter.model)
      .mockRejectedValueOnce(new PlanValidationError(['JSON：方案输出被长度限制截断']))
      .mockResolvedValueOnce(validText)
      .mockResolvedValueOnce(patch);
    expect((await controller.run('页面', { reviewPlan: false })).phase).toBe('succeeded');
    expect(adapter.model).toHaveBeenCalledTimes(3);
  });
  it('cancellation during correction prevents generation and file writes', async () => {
    const { adapter, controller } = fixture();
    vi.mocked(adapter.model)
      .mockResolvedValueOnce('{}')
      .mockImplementationOnce(async () => {
        controller.cancel();
        return validText;
      });
    expect((await controller.run('页面')).phase).toBe('cancelled');
    expect(adapter.model).toHaveBeenCalledTimes(2);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
  });
  it('checks the current source again before spending a correction request', async () => {
    const { adapter, controller, setFiles } = fixture();
    vi.mocked(adapter.model).mockImplementationOnce(async () => {
      setFiles({ ...REACT_VITE_TEMPLATE, 'user.txt': 'newer local change' });
      return '{}';
    });
    expect((await controller.run('页面')).detail).toContain('源码版本已变化');
    expect(adapter.model).toHaveBeenCalledOnce();
    expect(adapter.apply).not.toHaveBeenCalled();
  });
  it('does not use format correction to bypass an unsupported plan', async () => {
    const { adapter, controller } = fixture();
    vi.mocked(adapter.model).mockResolvedValue(JSON.stringify({ ...valid, backendMode: 'required' }));
    expect((await controller.run('Java 服务', { reviewPlan: false })).phase).toBe('failed');
    expect(adapter.model).toHaveBeenCalledOnce();
    expect(adapter.apply).not.toHaveBeenCalled();
  });
});
