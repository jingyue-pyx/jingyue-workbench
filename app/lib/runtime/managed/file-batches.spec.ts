import { describe, expect, it, vi } from 'vitest';
import { createBatchedModel, parseFileManifest } from './file-batches';
import { OutputLimitError, RunError, parsePatch, type ManagedModelInput, type SourceFiles } from './protocol';
import { ManagedRunController, type RunAdapter } from './controller';
import { STYLED_REACT_VITE_TEMPLATE } from './template';
import { managedOutputTokens, managedTrace, MANAGED_TASK_BUDGET } from './request-policy';

const manifest = (...paths: string[]) =>
  JSON.stringify({
    status: 'changed',
    summary: '更新模块',
    files: paths.map((path) => ({ path, instruction: '按计划更新，保留其它功能' })),
  });
const patch = (files: Record<string, string>) =>
  JSON.stringify({
    status: 'changed',
    summary: '候选改动',
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
  });
const input = (files: SourceFiles = {}): ManagedModelInput => ({
  task: '实现投流功能',
  files,
  errors: [],
  runId: '8c1e4b17-f6e4-4d7a-9e29-a50174634828',
  attempt: 0,
});
const signal = () => new AbortController().signal;
const options = () => ({ guard: vi.fn(), retain: vi.fn().mockResolvedValue(undefined), diagnostic: vi.fn() });

describe('bounded file scheduling', () => {
  it('allows a full 16-file manifest within the increased finite task budget', async () => {
    const paths = Array.from({ length: 16 }, (_, index) => `src/module${index}.ts`);

    /*
     * Small complete outputs still reserve 8k each. Use large existing files to
     * exercise sixteen single-file calls without retransmitting entire files.
     */
    const before = Object.fromEntries(paths.map((path) => [path, '//'.repeat(3100) + '\nexport const value = 0;']));
    const request = vi.fn(async (phase, payload) =>
      phase === 'manifest'
        ? manifest(...paths)
        : JSON.stringify({
            summary: 'update',
            files: payload.batch.files.map(({ path }: { path: string }) => ({
              path,
              edits: [{ search: 'export const value = 0;', replace: 'export const value = 1;' }],
            })),
          }),
    );
    const result = await createBatchedModel(request, options())('generate', input(before), signal());
    expect(parsePatch(result, before).files).toHaveLength(16);
    expect(request).toHaveBeenCalledTimes(17);
    expect(MANAGED_TASK_BUDGET).toEqual({ maxCalls: 32, maxReservedTokens: 160000 });
  });

  it('still stops at the new request ceiling rather than allowing unlimited repairs', async () => {
    const request = vi.fn().mockResolvedValue('test');
    const model = createBatchedModel(request, options());

    for (let i = 0; i < 32; i++) {
      await model('plan', input(), signal());
    }
    await expect(model('plan', input(), signal())).rejects.toMatchObject({ category: 'batch-budget' });
  });
  it('independently enforces the new output reservation ceiling', async () => {
    const request = vi.fn().mockResolvedValue('test');
    const model = createBatchedModel(request, { ...options(), maxCalls: 100 });

    for (let i = 0; i < 61; i++) {
      await model('plan', input(), signal());
    }
    await expect(model('plan', input(), signal())).rejects.toMatchObject({ category: 'batch-budget' });
  });
  it('allows an explicit no-op for over-selected existing files without discarding prior completed batches', async () => {
    const before = { 'src/style.css': 'a'.repeat(7000) };
    const request = vi
      .fn()
      .mockResolvedValueOnce(manifest('src/A.tsx', 'src/style.css'))
      .mockResolvedValueOnce(patch({ 'src/A.tsx': 'export const A = 1;' }))
      .mockResolvedValueOnce(JSON.stringify({ status: 'unchanged', summary: '已有样式足够，无需修改', files: [] }));
    const result = parsePatch(
      await createBatchedModel(request, options())('generate', input(before), signal()),
      before,
    );
    expect(result.status).toBe('changed');
    expect(result.files.map((file) => file.path)).toEqual(['src/A.tsx']);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('never treats a skipped new file as a completed manifest task', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(manifest('src/new.tsx'))
      .mockResolvedValue(JSON.stringify({ status: 'unchanged', summary: '无需改动', files: [] }));
    await expect(createBatchedModel(request, options())('generate', input(), signal())).rejects.toMatchObject({
      category: 'batch-format',
    });
  });
  it('requires bounded exact edits for existing large files instead of accepting another full retransmission', async () => {
    const before = { 'src/App.tsx': 'a'.repeat(7000) + 'unique footer' };
    const request = vi
      .fn()
      .mockResolvedValueOnce(manifest('src/App.tsx'))
      .mockResolvedValueOnce(patch({ 'src/App.tsx': 'full rewritten file' }))
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: 'edit',
          files: [{ path: 'src/App.tsx', edits: [{ search: 'unique footer', replace: 'new footer' }] }],
        }),
      );
    const result = await createBatchedModel(request, options())('generate', input(before), signal());
    expect(request.mock.calls[1][1].batch.editOnlyPaths).toEqual(['src/App.tsx']);
    expect(request.mock.calls[2][1].batch.editOnlyPaths).toEqual(['src/App.tsx']);
    expect(parsePatch(result, before).files[0].content).toBe('a'.repeat(7000) + 'new footer');
  });
  it('rejects whole-file retransmission disguised as a large exact edit', () => {
    const before = { 'src/App.tsx': 'a'.repeat(14000) };
    const raw = JSON.stringify({
      summary: 'large',
      files: [{ path: 'src/App.tsx', edits: [{ search: before['src/App.tsx'], replace: 'new' }] }],
    });
    expect(() => parsePatch(raw, before, [], ['src/App.tsx'])).toThrow('修改片段过长');
  });
  it.each([
    '{"status":"changed",',
    manifest('../secret'),
    manifest('.env'),
    manifest('src/A.tsx', 'src/A.tsx'),
    manifest(...Array.from({ length: 17 }, (_, i) => `src/A${i}.tsx`)),
    JSON.stringify({ status: 'changed', summary: '没有文件', files: [] }),
  ])('rejects an unsafe or incomplete manifest: %s', (text) => {
    expect(() => parseFileManifest(text)).toThrow(RunError);
  });

  it('splits only the truncated batch and keeps prior successful candidates out of the live source', async () => {
    const before = { 'src/App.tsx': 'a'.repeat(7000) + 'unique marker' };
    const request = vi
      .fn()
      .mockResolvedValueOnce(manifest('src/App.tsx', 'src/B.tsx', 'src/C.tsx'))
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: 'small edit',
          files: [{ path: 'src/App.tsx', edits: [{ search: 'unique marker', replace: 'updated main' }] }],
        }),
      )
      .mockRejectedValueOnce(new OutputLimitError())
      .mockResolvedValueOnce(patch({ 'src/B.tsx': 'export const B = 1;' }))
      .mockResolvedValueOnce(patch({ 'src/C.tsx': 'export const C = 2;' }));
    const hooks = options();
    const result = await createBatchedModel(request, { ...hooks, capture: () => before })(
      'generate',
      input(before),
      signal(),
    );
    expect(parsePatch(result, before).files).toHaveLength(3);
    expect(
      request.mock.calls.slice(1).map(([, p]) => p.batch.files.map((file: { path: string }) => file.path)),
    ).toEqual([['src/App.tsx'], ['src/B.tsx', 'src/C.tsx'], ['src/B.tsx'], ['src/C.tsx']]);
    expect(request.mock.calls[3][1].files['src/App.tsx']).toContain('updated main');
    expect(request.mock.calls[4][1].files['src/B.tsx']).toContain('B = 1');
    expect(request.mock.calls[4][1].filePlan).toHaveLength(3);
    expect(hooks.retain).toHaveBeenCalledTimes(3);
    expect(hooks.diagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ batch: expect.objectContaining({ id: 2 }) }),
      'output_limit',
    );
    expect(before['src/App.tsx']).toContain('unique marker');
  });

  it('retries a singleton once, then propagates output-limit without a full-task regeneration', async () => {
    const request = vi.fn().mockResolvedValueOnce(manifest('src/App.tsx')).mockRejectedValue(new OutputLimitError());
    const hooks = options();
    await expect(createBatchedModel(request, hooks)('generate', input(), signal())).rejects.toBeInstanceOf(
      OutputLimitError,
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][1].batch.recovery).toBe(true);
    expect(hooks.retain).not.toHaveBeenCalled();
  });

  it('preserves mandatory full-file fallback across a multi-file split', async () => {
    const before = { 'src/A.tsx': 'old A', 'src/B.tsx': 'old B' };
    const bad = JSON.stringify({
      summary: 'edit',
      files: [{ path: 'src/A.tsx', edits: [{ search: 'missing', replace: 'A' }] }],
    });
    const request = vi
      .fn()
      .mockResolvedValueOnce(manifest('src/A.tsx', 'src/B.tsx'))
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(patch({ 'src/A.tsx': 'new A' }))
      .mockResolvedValueOnce(patch({ 'src/B.tsx': 'new B' }));
    await createBatchedModel(request, options())('repair', input(before), signal());
    expect(request.mock.calls[2][1].fullFilePaths).toContain('src/A.tsx');
  });

  it.each(['missing', 'scope', 'invalid'])('repairs %s batch output once before retaining it', async (kind) => {
    const bad = kind === 'invalid' ? '{' : patch(kind === 'missing' ? {} : { 'src/unlisted.tsx': 'x' });
    const request = vi
      .fn()
      .mockResolvedValueOnce(manifest('src/A.tsx'))
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(patch({ 'src/A.tsx': 'complete' }));
    const hooks = options();
    await createBatchedModel(request, hooks)('generate', input(), signal());
    expect(hooks.retain).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(3);

    if (kind === 'scope') {
      expect(request.mock.calls[2][1].errors.join(' ')).toContain('src/unlisted.tsx');
      expect(request.mock.calls[2][1].errors.join(' ')).toContain('src/A.tsx');
    }
  });

  it('isolates existing-file edits even when both files are small', async () => {
    const request = vi.fn(async (phase, payload) =>
      phase === 'manifest'
        ? manifest('src/A.tsx', 'src/B.tsx')
        : patch({ [payload.batch.files[0].path]: 'export const updated = 1;' }),
    );
    await createBatchedModel(request, options())(
      'generate',
      input({ 'src/A.tsx': 'old A', 'src/B.tsx': 'old B' }),
      signal(),
    );
    expect(
      request.mock.calls.slice(1).map(([, payload]) => payload.batch.files.map((file: { path: string }) => file.path)),
    ).toEqual([['src/A.tsx'], ['src/B.tsx']]);
  });

  it.each([new RunError('模型额度限制', false), new RunError('connection lost', false, 'network')])(
    'does not retry quota/network failures',
    async (failure) => {
      const request = vi.fn().mockResolvedValueOnce(manifest('src/A.tsx')).mockRejectedValue(failure);
      await expect(createBatchedModel(request, options())('generate', input(), signal())).rejects.toBe(failure);
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it('corrects the manifest once and never salvages truncated source JSON', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new OutputLimitError())
      .mockResolvedValueOnce(manifest('src/A.tsx'))
      .mockResolvedValueOnce(patch({ 'src/A.tsx': 'complete' }));
    await createBatchedModel(request, options())('generate', input(), signal());
    expect(request.mock.calls.map(([phase]) => phase)).toEqual(['manifest', 'manifest', 'generate']);
  });

  it.each([{ maxCalls: 1 }, { maxReservedTokens: 2600 }])('enforces task-wide budgets: %j', async (budget) => {
    const request = vi.fn().mockResolvedValue(manifest('src/A.tsx'));
    await expect(
      createBatchedModel(request, { ...options(), ...budget })('generate', input(), signal()),
    ).rejects.toMatchObject({ category: 'batch-budget', repairable: false });
    expect(request).toHaveBeenCalledOnce();
  });

  it('detects a live source change even when the manual-edit revision is unchanged', async () => {
    let live = { 'src/A.tsx': 'original' };
    const request = vi
      .fn()
      .mockResolvedValueOnce(manifest('src/A.tsx'))
      .mockImplementationOnce(async () => {
        live = { 'src/A.tsx': 'user edit' };
        return patch({ 'src/A.tsx': 'generated' });
      });
    const hooks = options();
    await expect(
      createBatchedModel(request, { ...hooks, capture: () => live })('generate', input(live), signal()),
    ).rejects.toMatchObject({ category: 'source-conflict' });
    expect(hooks.retain).not.toHaveBeenCalled();
  });

  it('cancels between batches without another model call', async () => {
    const abort = new AbortController();
    const request = vi
      .fn()
      .mockResolvedValueOnce(manifest('src/A.tsx', 'src/B.tsx', 'src/C.tsx'))
      .mockResolvedValueOnce(patch({ 'src/A.tsx': 'A', 'src/B.tsx': 'B' }));
    await expect(
      createBatchedModel(request, {
        ...options(),
        retain: async () => {
          abort.abort();
        },
      })('generate', input(), abort.signal),
    ).rejects.toBeDefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('stages all batches, compiles their combined project, then applies exactly once', async () => {
    const original = { ...STYLED_REACT_VITE_TEMPLATE };
    let live = { ...original };
    const raw = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ goal: '投流面板', steps: ['模块', '验证'], supported: true }))
      .mockResolvedValueOnce(manifest('src/Panel.tsx', 'src/App.tsx', 'src/theme.css'))
      .mockResolvedValueOnce(
        patch({
          'src/Panel.tsx': 'export default function Panel(){return <main>投流</main>}',
        }),
      )
      .mockResolvedValueOnce(
        patch({ 'src/App.tsx': 'import Panel from "./Panel"; import "./theme.css"; export default Panel;' }),
      )
      .mockResolvedValueOnce(patch({ 'src/theme.css': 'main{color:red}' }));
    const compile = vi.fn(async (candidate: SourceFiles) => {
      expect(candidate['src/theme.css']).toContain('color:red');
      expect(live).toEqual(original);
    });
    const adapter: RunAdapter = {
      capture: () => live,
      revision: () => 0,
      checkpoint: async () => {},
      model: createBatchedModel(raw, { ...options(), capture: () => live }),
      compileCandidate: compile,
      apply: vi.fn(async (files) => {
        live = { ...files };
      }),
      verify: vi.fn().mockResolvedValue('https://preview.example.test'),
      stop: vi.fn(),
      record: async () => {},
    };
    const result = await new ManagedRunController(adapter, () => {}).run('实现投流面板', { reviewPlan: false });
    expect(result.phase).toBe('succeeded');
    expect(compile).toHaveBeenCalledOnce();
    expect(adapter.apply).toHaveBeenCalledOnce();
    expect(adapter.verify).toHaveBeenCalledOnce();
    expect(raw.mock.calls.every(([, p]) => p.runId === result.id)).toBe(true);
  });
  it('does not restart whole-project generation after the batch scheduler exhausts its truncation retry', async () => {
    const live = { ...STYLED_REACT_VITE_TEMPLATE };
    const raw = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ goal: '修改', steps: ['修改', '检查'], supported: true }))
      .mockResolvedValueOnce(manifest('src/App.tsx'))
      .mockRejectedValue(new OutputLimitError());
    const adapter: RunAdapter = {
      capture: () => live,
      revision: () => 0,
      checkpoint: vi.fn().mockResolvedValue(undefined),
      model: createBatchedModel(raw, { ...options(), capture: () => live }),
      apply: vi.fn(),
      compileCandidate: vi.fn(),
      verify: vi.fn(),
      stop: vi.fn(),
      record: vi.fn().mockResolvedValue(undefined),
    };
    const result = await new ManagedRunController(adapter, vi.fn()).run('修改', { reviewPlan: false });
    expect(result).toMatchObject({ phase: 'failed', attempt: 0 });
    expect(result.detail).toContain('长度限制');
    expect(raw).toHaveBeenCalledTimes(4);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.compileCandidate).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
  });
});

describe('request policy and safe correlation', () => {
  it('uses finite server budgets and ignores caller token injection', () => {
    expect(managedOutputTokens('manifest', 'recovery')).toBe(2600);
    expect(managedOutputTokens('generate', 'file')).toBe(8000);
    expect(managedOutputTokens('repair', 'recovery')).toBe(16000);
    expect(managedOutputTokens('repair', { maxTokens: 999999 })).toBe(12000);
  });
  it('keeps only validated identifiers and bounded numbers', () => {
    const safe = { runId: input().runId, projectId: 'd63cb19b-9fef-4ae7-8855-293ad3fb2be2', attempt: 2, batch: 3 };
    expect(managedTrace({ ...safe, secret: 'never log' })).toEqual(safe);
    expect(managedTrace({ projectId: 'private prompt', runId: 'token', attempt: 3, batch: 99 })).toEqual({});
  });
});
