import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagedRunController, type RunAdapter } from './controller';
import {
  inspectProject,
  managedSystemPrompt,
  parsePatch,
  parsePlan,
  RunError,
  safeDiagnostic,
  terminalPhase,
  type SourceFiles,
} from './protocol';
import { REACT_VITE_TEMPLATE, STYLED_REACT_VITE_TEMPLATE } from './template';
import { previewProbeScript } from './webcontainer-runtime';

const plan = JSON.stringify({ goal: '制作待办清单', steps: ['添加清单与按钮', '编译并检查预览'], supported: true });
const patch = (text = '待办') =>
  JSON.stringify({
    summary: '修改应用',
    files: [{ path: 'src/App.tsx', content: `export default function App(){return <main>${text}</main>}` }],
  });

function fixture() {
  let files: SourceFiles = {};
  let revision = 0;
  const adapter: RunAdapter = {
    capture: () => ({ ...files }),
    revision: () => revision,
    checkpoint: vi.fn().mockResolvedValue(undefined),
    model: vi.fn().mockResolvedValueOnce(plan).mockResolvedValue(patch()),
    apply: vi.fn(async (changes) => {
      files = { ...files, ...changes };
    }),
    verify: vi.fn().mockResolvedValue('https://preview.example.test'),
    stop: vi.fn(),
    record: vi.fn().mockResolvedValue(undefined),
  };
  const publish = vi.fn();
  const controller = new ManagedRunController(adapter, publish);

  return {
    adapter,
    publish,
    controller,
    edit: () => revision++,
    setFiles: (f: SourceFiles) => {
      files = f;
    },
  };
}
afterEach(() => vi.useRealTimers());

describe('managed task lifecycle', () => {
  it('repairs compiler-rejected candidates before any live write or preview stop', async () => {
    const { controller, adapter, setFiles } = fixture();
    const original = { ...REACT_VITE_TEMPLATE };
    setFiles(original);
    adapter.compileCandidate = vi
      .fn()
      .mockRejectedValueOnce(new RunError('TS2322 candidate type failure', true, 'compile'))
      .mockResolvedValue(undefined);
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(patch('candidate one'))
      .mockImplementationOnce(async (_phase, payload) => {
        expect(adapter.capture()).toEqual(original);
        expect(adapter.stop).not.toHaveBeenCalled();
        expect(adapter.apply).not.toHaveBeenCalled();
        expect(payload.files['src/App.tsx']).toContain('candidate one');

        return patch('candidate repaired');
      });

    const result = await controller.run('修改');
    expect(result.phase).toBe('succeeded');
    expect(result.candidatePending).toBe(false);
    expect(adapter.compileCandidate).toHaveBeenCalledTimes(2);
    expect(adapter.apply).toHaveBeenCalledOnce();
    expect(adapter.verify).toHaveBeenCalledOnce();
  });
  it('keeps the live runtime untouched when a candidate installation cannot recover', async () => {
    const { controller, adapter, setFiles } = fixture();
    const original = { ...REACT_VITE_TEMPLATE };
    setFiles(original);
    adapter.compileCandidate = vi.fn().mockRejectedValue(new RunError('依赖安装不完整', false, 'dependencies'));

    const result = await controller.run('修改');
    expect(result).toMatchObject({ phase: 'failed', candidatePending: true });
    expect(adapter.capture()).toEqual(original);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.verify).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
    expect(adapter.model).toHaveBeenCalledTimes(2);
  });
  it('rejects source changes made while candidate compilation was pending', async () => {
    const { controller, adapter, setFiles } = fixture();
    setFiles({ ...REACT_VITE_TEMPLATE });

    const latest = { ...REACT_VITE_TEMPLATE, 'note.txt': 'user newest change' };
    adapter.compileCandidate = vi.fn(async () => {
      setFiles(latest);
    });
    expect((await controller.run('修改')).detail).toContain('源码版本已变化');
    expect(adapter.capture()).toEqual(latest);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
  });
  it('cancels pre-commit compilation without stopping the already running live preview', async () => {
    const { controller, adapter, setFiles } = fixture();
    setFiles({ ...REACT_VITE_TEMPLATE });
    adapter.compileCandidate = vi.fn(async (_files, signal) => {
      controller.cancel('stop candidate');
      signal.throwIfAborted();
    });
    expect((await controller.run('修改')).phase).toBe('cancelled');
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
  });
  it('keeps rejected multi-file candidates off the live project and repairs against the retained candidate', async () => {
    const { controller, adapter, setFiles } = fixture();
    const original = { ...REACT_VITE_TEMPLATE };
    setFiles(original);
    adapter.retainCandidate = vi.fn().mockResolvedValue(undefined);

    const broken = 'export default function App(){return <main><h1>营销</main>}';
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: '添加模块',
          files: [
            { path: 'src/App.tsx', content: broken },
            { path: 'src/info.ts', content: 'export const title = "keep this addition";' },
          ],
        }),
      )
      .mockImplementationOnce(async (_phase, payload) => {
        expect(adapter.capture()).toEqual(original);
        expect(adapter.apply).not.toHaveBeenCalled();
        expect(adapter.stop).not.toHaveBeenCalled();
        expect(payload.files['src/App.tsx']).toBe(broken);
        expect(payload.files['src/info.ts']).toContain('keep this addition');
        expect(payload.errors[0]).toContain('语法检查失败');
        expect(payload.sourceRevision).toMatch(/^[a-f0-9]{64}$/);

        return patch('营销');
      });
    expect((await controller.run('营销页面')).phase).toBe('succeeded');
    expect(adapter.apply).toHaveBeenCalledOnce();
    expect(adapter.capture()['src/info.ts']).toContain('keep this addition');
    expect(adapter.retainCandidate).toHaveBeenCalledTimes(2);
  });
  it('does not write a placeholder or stop a preview when new-project generation is invalid', async () => {
    const { controller, adapter } = fixture();
    vi.mocked(adapter.model).mockReset().mockResolvedValueOnce(plan).mockResolvedValue('broken JSON');
    expect((await controller.run('新页面')).phase).toBe('failed');
    expect(adapter.capture()).toEqual({});
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
  });
  it('rejects source drift even if it does not increment the manual-edit counter', async () => {
    const { controller, adapter, setFiles } = fixture();
    setFiles({ ...REACT_VITE_TEMPLATE });

    const latest = {
      ...REACT_VITE_TEMPLATE,
      'src/App.tsx': 'export default function App(){return <main>用户最新版本</main>}',
    };
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockImplementationOnce(async () => {
        setFiles(latest);
        return patch('stale model response');
      });

    const result = await controller.run('修改页面');
    expect(result.phase).toBe('failed');
    expect(result.detail).toContain('源码版本已变化');
    expect(adapter.capture()).toEqual(latest);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
  });
  it('checks live revision again after saving a candidate checkpoint', async () => {
    const { controller, adapter, setFiles } = fixture();
    setFiles({ ...REACT_VITE_TEMPLATE });
    adapter.retainCandidate = vi.fn(async () => {
      setFiles({ ...REACT_VITE_TEMPLATE, 'new.txt': 'changed while awaiting storage' });
    });
    expect((await controller.run('修改页面')).detail).toContain('源码版本已变化');
    expect(adapter.apply).not.toHaveBeenCalled();
  });
  it('style repair never applies the unstyled intermediate candidate', async () => {
    const { controller, adapter, setFiles } = fixture();
    const original = { ...REACT_VITE_TEMPLATE };
    setFiles(original);
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: '样式',
          files: [
            {
              path: 'src/App.tsx',
              content: 'export default function App(){return <main className="flex gap-4 p-8 text-red-500"/>}',
            },
          ],
        }),
      )
      .mockImplementationOnce(async () => {
        expect(adapter.capture()).toEqual(original);
        expect(adapter.apply).not.toHaveBeenCalled();

        return patch('正确原生样式');
      });
    expect((await controller.run('页面')).phase).toBe('succeeded');
    expect(adapter.apply).toHaveBeenCalledOnce();
  });
  it('recovers an instrumented-source mismatch with complete content and dispatches verification', async () => {
    const { controller, adapter, setFiles } = fixture();
    const original = {
      ...REACT_VITE_TEMPLATE,
      'src/App.tsx': 'export default function App(){return <main data-oid="jy-test">旧页面</main>}',
    };
    setFiles(original);
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: '修改页面',
          files: [{ path: 'src/App.tsx', edits: [{ search: '<main>旧页面</main>', replace: '<main>新页面</main>' }] }],
        }),
      )
      .mockImplementationOnce(async (phase, payload) => {
        expect(phase).toBe('repair');
        expect(payload.fullFilePaths).toEqual(['src/App.tsx']);
        expect(payload.files).toEqual(original);
        expect(adapter.apply).not.toHaveBeenCalled();
        expect(payload.errors[0]).toContain('完整 content');

        return patch('新页面');
      });

    const result = await controller.run('生成营销页面', { reviewPlan: false });
    expect(result.phase).toBe('succeeded');
    expect(result.attempt).toBe(1);
    expect(adapter.apply).toHaveBeenCalledOnce();
    expect(adapter.verify).toHaveBeenCalledOnce();
  });
  it('does not expand the repair budget if the model ignores complete-file recovery', async () => {
    const { controller, adapter, setFiles } = fixture();
    setFiles({ ...REACT_VITE_TEMPLATE });
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValue(
        JSON.stringify({
          summary: '修改页面',
          files: [{ path: 'src/App.tsx', edits: [{ search: 'missing', replace: 'new' }] }],
        }),
      );

    const result = await controller.run('修复页面', { reviewPlan: false });
    expect(result.phase).toBe('failed');
    expect(adapter.model).toHaveBeenCalledTimes(4);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.verify).not.toHaveBeenCalled();
    expect(adapter.capture()).toEqual(REACT_VITE_TEMPLATE);
  });
  it('applies an exact functional fix and still runs the full verifier', async () => {
    const { controller, adapter, setFiles } = fixture();
    setFiles({
      ...REACT_VITE_TEMPLATE,
      'src/App.tsx': 'export default function App(){return <button onClick={() => alert("demo")}>体验</button>}',
    });
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(
        JSON.stringify({
          status: 'changed',
          summary: '接上体验入口',
          files: [{ path: 'src/App.tsx', edits: [{ search: 'alert("demo")', replace: 'location.hash = "demo"' }] }],
        }),
      );
    expect((await controller.run('修复体验入口', { reviewPlan: false })).phase).toBe('succeeded');
    expect(adapter.verify).toHaveBeenCalledOnce();
    expect(adapter.capture()['src/App.tsx']).toContain('location.hash = "demo"');
    expect(adapter.capture()['src/App.tsx']).not.toContain('alert');
  });
  it('direct implementation keeps internal planning and verification without an approval card', async () => {
    const { controller, adapter, publish } = fixture();
    adapter.review = vi.fn();

    const result = await controller.run('生成一个营销页面', { reviewPlan: false });
    expect(result.phase).toBe('succeeded');
    expect(adapter.review).not.toHaveBeenCalled();
    expect(vi.mocked(adapter.model).mock.calls.map(([phase]) => phase)).toEqual(['plan', 'generate']);
    expect(adapter.verify).toHaveBeenCalledOnce();
    expect(publish.mock.calls.some(([state]) => state.phase === 'reviewing')).toBe(false);
  });
  it('explicit design requests wait for approval without applying files', async () => {
    const { controller, adapter } = fixture();
    let approve!: () => void;
    adapter.review = vi.fn(
      () =>
        new Promise<{ kind: 'confirm' }>((resolve) => {
          approve = () => resolve({ kind: 'confirm' });
        }),
    );

    const run = controller.run('帮我设计一下营销页面', { reviewPlan: true });
    await vi.waitFor(() => expect(adapter.review).toHaveBeenCalledOnce());
    expect(adapter.apply).not.toHaveBeenCalled();
    approve();
    expect((await run).phase).toBe('succeeded');
  });
  it('does not auto-select unresolved scope choices in direct mode', async () => {
    const { controller, adapter } = fixture();
    const questionPlan = JSON.stringify({
      ...JSON.parse(plan),
      questions: [
        {
          id: 'scope',
          title: '采用哪种范围？',
          options: [
            { id: 'demo', label: '前端演示', description: '模拟数据' },
            { id: 'backend', label: '真实后端', description: '需另行建设' },
          ],
        },
      ],
    });
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(questionPlan)
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(patch());
    adapter.review = vi.fn(async () => {
      expect(adapter.apply).not.toHaveBeenCalled();
      return { kind: 'confirm' as const, answers: { scope: 'demo' } };
    });
    expect((await controller.run('制作管理系统', { reviewPlan: false })).phase).toBe('succeeded');
    expect(adapter.review).toHaveBeenCalledTimes(2);
  });
  it.each(['explicit', 'empty', 'identical'])(
    'requires an explicit no-change result for %s output, never failed generation or verified success',
    async (kind) => {
      const { controller, adapter, setFiles } = fixture();
      const existing = { ...REACT_VITE_TEMPLATE };
      delete existing['src/lib/jingyue-data.ts'];
      setFiles(existing);

      const resultText = JSON.stringify({
        ...(kind === 'explicit' ? { status: 'unchanged' } : {}),
        summary: '注册页面已存在，请通过 /register 打开。',
        files: kind === 'identical' ? [{ path: 'src/App.tsx', content: existing['src/App.tsx'] }] : [],
      });
      vi.mocked(adapter.model)
        .mockReset()
        .mockResolvedValueOnce(plan)
        .mockResolvedValueOnce(resultText)
        .mockResolvedValueOnce(JSON.stringify({ status: 'unchanged', summary: '入口在 /register。', files: [] }));

      const result = await controller.run('注册的页面没有实现');
      expect(result.phase).toBe('unchanged');
      expect(terminalPhase(result.phase)).toBe(true);
      expect(result.detail).toContain('/register');
      expect(result.changed).toEqual([]);
      expect(result.errors).toHaveLength(kind === 'explicit' ? 0 : 1);
      expect(adapter.model).toHaveBeenCalledTimes(kind === 'explicit' ? 2 : 3);
      expect(adapter.apply).not.toHaveBeenCalled();
      expect(adapter.stop).not.toHaveBeenCalled();
      expect(adapter.verify).not.toHaveBeenCalled();
      expect(adapter.capture()).toEqual(existing);
      vi.mocked(adapter.model).mockReset().mockResolvedValueOnce(plan).mockResolvedValueOnce(patch('优化注册'));
      expect((await controller.run('添加注册提示')).phase).toBe('succeeded');
      expect(adapter.capture()['src/App.tsx']).toContain('优化注册');
      expect(adapter.verify).toHaveBeenCalledOnce();
    },
  );
  it('never accepts a no-op as a newly generated app', async () => {
    const { controller, adapter } = fixture();
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValue(JSON.stringify({ status: 'unchanged', summary: '无需改动', files: [] }));

    const result = await controller.run('新建应用');
    expect(result.phase).toBe('failed');
    expect(result.detail).toContain('未提供实际改动');
    expect(adapter.verify).not.toHaveBeenCalled();
  });
  it('does not let empty output clear known style errors', async () => {
    const { controller, adapter, setFiles } = fixture();
    setFiles({
      ...REACT_VITE_TEMPLATE,
      'src/App.tsx':
        'export default function App(){return <main className="py-20 px-4 gap-8 text-gray-900">旧页</main>}',
    });
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValue(JSON.stringify({ status: 'unchanged', summary: '已实现', files: [] }));
    expect((await controller.run('修好样式')).phase).toBe('failed');
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
    expect(adapter.verify).not.toHaveBeenCalled();
    expect(adapter.model).toHaveBeenCalledTimes(3);
  });
  it('still rejects incomplete JSON and unexplained empty responses', () => {
    expect(() => parsePatch('{"summary":"unfinished","files":[', REACT_VITE_TEMPLATE)).toThrow('格式不完整');
    expect(() => parsePatch('{"summary":" ","files":[]}', REACT_VITE_TEMPLATE)).toThrow('可执行');
    expect(() => parsePatch('{"summary":"发现问题但没有代码","files":[]}', REACT_VITE_TEMPLATE)).toThrow(
      '未提供实际改动',
    );
    expect(() =>
      parsePatch(
        '{"status":"unchanged","summary":"不改","files":[{"path":"src/x.ts","content":"x"}]}',
        REACT_VITE_TEMPLATE,
      ),
    ).toThrow('不能同时');
  });
  it('asks for concrete changes when an ambiguous empty patch describes a defect', async () => {
    const { controller, adapter, setFiles } = fixture();
    setFiles({ ...REACT_VITE_TEMPLATE });
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(JSON.stringify({ summary: '发现输入框未绑定事件', files: [] }))
      .mockResolvedValueOnce(patch('已绑定事件'));
    expect((await controller.run('优化表单')).phase).toBe('succeeded');
    expect(vi.mocked(adapter.model).mock.calls[2][1].errors[0]).toContain('必要文件的完整修改');
    expect(adapter.verify).toHaveBeenCalledOnce();
    expect(adapter.capture()['src/App.tsx']).toContain('已绑定事件');
  });
  it('does not call the model, request approval or write files when the runtime cannot start', async () => {
    const { controller, adapter } = fixture();
    adapter.prepare = vi.fn().mockRejectedValue(new RunError('浏览器沙箱启动超时', false, 'sandbox'));
    adapter.review = vi.fn();

    const result = await controller.run('创建登录页面');
    expect(result.phase).toBe('failed');
    expect(result.detail).toContain('沙箱启动');
    expect(adapter.model).not.toHaveBeenCalled();
    expect(adapter.review).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
    expect(adapter.record).toHaveBeenCalledOnce();
  });
  it('keeps an existing preview running when model output fails before any writes', async () => {
    const { controller, adapter, setFiles } = fixture();
    setFiles({ ...REACT_VITE_TEMPLATE });
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockRejectedValueOnce(new RunError('模型输出未完整结束', false, 'model-output'));
    expect((await controller.run('改善样式')).phase).toBe('failed');
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
    expect(adapter.verify).not.toHaveBeenCalled();
  });
  it('includes existing missing styles in the first generation instead of spending a repair round rediscovering them', async () => {
    const { controller, adapter, setFiles } = fixture();
    setFiles({
      ...REACT_VITE_TEMPLATE,
      'src/App.tsx':
        'export default function App(){return <main className="py-20 px-4 gap-8 text-gray-900">旧页</main>}',
    });
    expect((await controller.run('修复样式')).phase).toBe('succeeded');
    expect(vi.mocked(adapter.model).mock.calls[1][1].errors[0]).toContain('样式依赖缺失');
    expect(adapter.model).toHaveBeenCalledTimes(2);
  });
  it('repairs missing utility styles instead of treating a successful compilation as visual readiness', async () => {
    const { controller, adapter, setFiles } = fixture();
    setFiles({ ...REACT_VITE_TEMPLATE });
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: '页面',
          files: [
            {
              path: 'src/App.tsx',
              content:
                'export default function App(){return <main className="py-20 px-4 gap-8 text-gray-900"><svg className="w-10 h-10" /></main>}',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: '补全样式',
          files: [
            {
              path: 'src/style.css',
              content:
                '.py-20{padding-block:5rem}.px-4{padding-inline:1rem}.gap-8{gap:2rem}.text-gray-900{color:#222}.w-10{width:40px}.h-10{height:40px}',
            },
          ],
        }),
      );

    const result = await controller.run('营销页');
    expect(result.phase).toBe('succeeded');
    expect(result.attempt).toBe(1);
    expect(adapter.verify).toHaveBeenCalledOnce();
    expect(vi.mocked(adapter.model).mock.calls[2][1].errors[0]).toContain('样式依赖缺失');
  });
  it('repairs missing dependencies with the generated draft as context before compiling', async () => {
    const { controller, adapter } = fixture();
    const source = 'import { Button } from "antd"; export default function App(){return <Button>活动</Button>}';
    const pkg = JSON.parse(STYLED_REACT_VITE_TEMPLATE['package.json']);
    pkg.dependencies.antd = '5.20.0';
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(JSON.stringify({ summary: '活动页面', files: [{ path: 'src/App.tsx', content: source }] }))
      .mockResolvedValueOnce(
        JSON.stringify({ summary: '补全依赖', files: [{ path: 'package.json', content: JSON.stringify(pkg) }] }),
      );

    const result = await controller.run('生成活动页面');
    expect(result.phase).toBe('succeeded');
    expect(result.attempt).toBe(1);
    expect(adapter.verify).toHaveBeenCalledOnce();

    const repair = vi.mocked(adapter.model).mock.calls[2];
    expect(repair[1].files['src/App.tsx']).toBe(source);
    expect(repair[1].errors[0]).toContain('未声明的依赖：antd');
  });
  it('plans before writing, creates a pinned baseline and succeeds only after verification', async () => {
    const { controller, adapter } = fixture();
    const result = await controller.run('待办');
    expect(result.phase).toBe('succeeded');
    expect(adapter.model).toHaveBeenCalledTimes(2);
    expect(adapter.checkpoint).toHaveBeenCalledWith({});
    expect(adapter.apply).toHaveBeenCalledOnce();
    expect(adapter.apply).toHaveBeenCalledWith(
      { ...STYLED_REACT_VITE_TEMPLATE, 'src/App.tsx': 'export default function App(){return <main>待办</main>}' },
      expect.any(AbortSignal),
    );
    expect(adapter.verify).toHaveBeenCalledOnce();
    expect(adapter.record).toHaveBeenCalledOnce();
  });
  it('repairs a failing build then verifies again', async () => {
    const { controller, adapter } = fixture();
    vi.mocked(adapter.verify)
      .mockRejectedValueOnce(new RunError('缺少导入', true))
      .mockResolvedValueOnce('https://preview.example.test');
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(patch('有错'))
      .mockResolvedValueOnce(patch('已修复'));

    const result = await controller.run('待办');
    expect(result.phase).toBe('succeeded');
    expect(result.attempt).toBe(1);
    expect(adapter.verify).toHaveBeenCalledTimes(2);
    expect(vi.mocked(adapter.model).mock.calls[2][0]).toBe('repair');
    expect(vi.mocked(adapter.model).mock.calls[2][1].errors).toContain('缺少导入');
  });
  it('never reports preview failure as success', async () => {
    const { controller, adapter } = fixture();
    vi.mocked(adapter.verify).mockRejectedValue(new RunError('预览白屏', false, 'preview'));
    expect((await controller.run('待办')).phase).toBe('failed');
    expect(adapter.stop).toHaveBeenCalled();
  });
  it('keeps an unverified running preview available after transport failure without generating again', async () => {
    const { controller, adapter } = fixture();
    vi.mocked(adapter.verify).mockRejectedValue(new RunError('预览连接检查超时', false, 'preview-network'));

    const result = await controller.run('待办');
    expect(result.phase).toBe('failed');
    expect(adapter.stop).not.toHaveBeenCalled();
    expect(adapter.model).toHaveBeenCalledTimes(2);
    expect(adapter.capture()['src/App.tsx']).toContain('待办');
  });
  it('caps model repairs at two even if each failure differs', async () => {
    const { controller, adapter } = fixture();
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(patch('1'))
      .mockResolvedValueOnce(patch('2'))
      .mockResolvedValueOnce(patch('3'));

    let count = 0;
    vi.mocked(adapter.verify).mockImplementation(async () => {
      throw new RunError(`错误 ${++count}`, true);
    });

    const result = await controller.run('待办');
    expect(result.phase).toBe('failed');
    expect(result.attempt).toBe(2);
    expect(adapter.model).toHaveBeenCalledTimes(4);
  });
  it('stops repeated unchanged diagnostics before another paid retry', async () => {
    const { controller, adapter } = fixture();
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce('{invalid')
      .mockResolvedValueOnce('{invalid');

    const result = await controller.run('待办');
    expect(result.detail).toContain('相同错误');
    expect(adapter.model).toHaveBeenCalledTimes(3);
  });
  it('continues automatic repair when the same type diagnostic remains but the candidate changed', async () => {
    const { controller, adapter, setFiles } = fixture();
    const original = { ...REACT_VITE_TEMPLATE };
    setFiles(original);
    adapter.compileCandidate = vi
      .fn()
      .mockRejectedValueOnce(new RunError('TS2322 repeated type error', true, 'compile'))
      .mockRejectedValueOnce(new RunError('TS2322 repeated type error', true, 'compile'))
      .mockResolvedValue(undefined);
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(patch('first'))
      .mockResolvedValueOnce(patch('second'))
      .mockImplementationOnce(async (phase, payload) => {
        expect(phase).toBe('repair');
        expect(payload.files['src/App.tsx']).toContain('second');
        expect(adapter.capture()).toEqual(original);
        expect(adapter.apply).not.toHaveBeenCalled();

        return patch('fixed');
      });

    const result = await controller.run('增加注册表单');
    expect(result).toMatchObject({ phase: 'succeeded', attempt: 2 });
    expect(adapter.compileCandidate).toHaveBeenCalledTimes(3);
    expect(adapter.apply).toHaveBeenCalledOnce();
  });
  it('unsupported plans do not modify or initialize files', async () => {
    const { controller, adapter } = fixture();
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValue(
        JSON.stringify({ goal: '支付系统', steps: ['需要后端'], supported: false, reason: '需要独立后端' }),
      );
    expect((await controller.run('支付系统')).detail).toBe('需要独立后端');
    expect(adapter.apply).not.toHaveBeenCalled();
  });
  it('never overwrites an unsupported existing project', async () => {
    const { controller, adapter, setFiles } = fixture();
    setFiles({ 'package.json': '{"dependencies":{"vue":"3.0.0"}}', 'src/user.txt': 'keep' });
    expect((await controller.run('修改')).phase).toBe('failed');
    expect(adapter.apply).not.toHaveBeenCalled();
  });
  it('blocks a model patch if the user edits while it is being generated', async () => {
    const { controller, adapter, edit } = fixture();
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockImplementationOnce(async () => {
        edit();
        return patch();
      });

    const result = await controller.run('待办');
    expect(result.detail).toContain('手动修改');
    expect(adapter.apply).not.toHaveBeenCalled(); // Even the template stays in the candidate until validated.
    expect(adapter.verify).not.toHaveBeenCalled();
  });
  it('cancel prevents late generation results from writing files', async () => {
    const { controller, adapter } = fixture();
    vi.mocked(adapter.model)
      .mockReset()
      .mockResolvedValueOnce(plan)
      .mockImplementationOnce(async () => {
        controller.cancel();
        return patch();
      });
    expect((await controller.run('待办')).phase).toBe('cancelled');
    expect(adapter.verify).not.toHaveBeenCalled();
  });
  it('save failure does not fabricate a build failure', async () => {
    const { controller, adapter } = fixture();
    vi.mocked(adapter.record).mockRejectedValue(new Error('offline'));
    expect((await controller.run('待办')).phase).toBe('succeeded');
  });
  it('checkpoint failure blocks automatic modifications', async () => {
    const { controller, adapter } = fixture();
    vi.mocked(adapter.checkpoint).mockRejectedValue(new Error('quota exceeded'));
    expect((await controller.run('待办')).phase).toBe('failed');
    expect(adapter.apply).not.toHaveBeenCalled();
  });
  it('overall deadline aborts an in-flight request', async () => {
    vi.useFakeTimers();

    const { adapter } = fixture();
    vi.mocked(adapter.model)
      .mockReset()
      .mockImplementation(
        (_phase, _payload, signal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      );

    const controller = new ManagedRunController(adapter, () => {}, { maxRepairs: 2, deadlineMs: 100 });
    const result = controller.run('等待');
    await vi.advanceTimersByTimeAsync(101);
    expect((await result).phase).toBe('cancelled');
    expect(adapter.apply).not.toHaveBeenCalled();
  });
});

describe('project and model output boundaries', () => {
  it('accepts pinned template and requires compiler dependencies', () => {
    expect(inspectProject(REACT_VITE_TEMPLATE).typed).toBe(true);

    const pkg = JSON.parse(REACT_VITE_TEMPLATE['package.json']);
    delete pkg.devDependencies.typescript;
    expect(() => inspectProject({ ...REACT_VITE_TEMPLATE, 'package.json': JSON.stringify(pkg) })).toThrow('缺少');
  });
  it.each([
    '../secret',
    '/tmp/file',
    '.env',
    'src/../../file',
    'node_modules/vite/bin/vite.js',
    'package-lock.json',
    'src/a\\b',
    'constructor/x',
  ])('rejects unsafe or runtime-owned path %s', (path) => {
    expect(() => parsePatch(JSON.stringify({ summary: 'x', files: [{ path, content: 'x' }] }), {})).toThrow();
  });
  it('does not permit overwriting validation configuration', () => {
    expect(() =>
      parsePatch(
        JSON.stringify({ summary: 'x', files: [{ path: 'tsconfig.json', content: '{}' }] }),
        REACT_VITE_TEMPLATE,
      ),
    ).toThrow('校验配置');
  });
  it('does not permit removing the type checker to hide errors', () => {
    const pkg = JSON.parse(REACT_VITE_TEMPLATE['package.json']);
    delete pkg.devDependencies.typescript;
    expect(() =>
      parsePatch(
        JSON.stringify({ summary: 'x', files: [{ path: 'package.json', content: JSON.stringify(pkg) }] }),
        REACT_VITE_TEMPLATE,
      ),
    ).toThrow('校验工具');
  });
  it('rejects duplicate output files and malformed plans', () => {
    expect(() =>
      parsePatch('{"summary":"x","files":[{"path":"a.ts","content":""},{"path":"a.ts","content":""}]}', {}),
    ).toThrow();
    expect(() => parsePlan('{"goal":"x","steps":[],"supported":true}')).toThrow();
  });
  it('does not switch package managers silently', () => {
    expect(() => inspectProject({ ...REACT_VITE_TEMPLATE, 'yarn.lock': 'lock' })).toThrow('包管理器');
  });
  it('rejects remote dependencies and project install scripts', () => {
    const pkg = JSON.parse(REACT_VITE_TEMPLATE['package.json']);
    pkg.dependencies.extra = 'https://example.test/pkg.tgz';
    expect(() => inspectProject({ ...REACT_VITE_TEMPLATE, 'package.json': JSON.stringify(pkg) })).toThrow('明确');
    delete pkg.dependencies.extra;
    pkg.scripts.postinstall = 'anything';
    expect(() => inspectProject({ ...REACT_VITE_TEMPLATE, 'package.json': JSON.stringify(pkg) })).toThrow('生命周期');
  });
  it('redacts secrets in diagnostics', () => {
    const result = safeDiagnostic('api_key=private-value password=another-value postgres://test:fixture@db/x');
    expect(result).not.toContain('private-value');
    expect(result).not.toContain('another-value');
    expect(result).not.toContain('test:fixture');
  });
  it('preview probe is syntactically valid and binds a run identity', () => {
    const source = previewProbeScript('run-fixture', 'https://workbench.example.test');
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain('run-fixture');
    expect(source).toContain('vite-error-overlay');
  });
  it('phase prompts never request model-provided shell execution', () => {
    expect(managedSystemPrompt('plan')).toContain('Do not generate files');
    expect(managedSystemPrompt('repair')).toContain('Never include secrets, terminal commands');
  });
});
