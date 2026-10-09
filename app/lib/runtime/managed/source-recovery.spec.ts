import { describe, expect, it, vi } from 'vitest';
import {
  bindFileSourceResponse,
  managedSystemPrompt,
  OutputLimitError,
  parsePatch,
  sourceEnvelope,
  type ManagedModelInput,
} from './protocol';
import { createBatchedModel } from './file-batches';
import { managedModelRequest } from './model-client';

const token = '2af53b82-945d-44cb-9024-9b1e3379a5a3';
const frame = (source: string, id = token) => {
  const { start, end } = sourceEnvelope(id);
  return `${start}\n${source}\n${end}`;
};
const task = (files = {}): ManagedModelInput => ({ task: '营销表单与预算方案', files, errors: [] });
const manifest = JSON.stringify({
  status: 'changed',
  summary: '表单与结果',
  files: [
    { path: 'src/Form.tsx', instruction: '活动目标与预算表单' },
    { path: 'src/App.tsx', instruction: '集成表单与方案' },
  ],
});

describe('framed source recovery after JSON failures', () => {
  it.each(['unchanged', 'changed'])(
    'recovers an omitted required new file after repeated %s responses',
    async (status) => {
      const request = vi.fn(async (phase, input) => {
        if (phase === 'manifest') {
          return JSON.stringify({
            status: 'changed',
            summary: '新建表单',
            files: [{ path: 'src/Form.tsx', instruction: '表单' }],
          });
        }

        if (input.batch.sourceToken) {
          return frame(
            'export default function Form(){return <form><input aria-label="预算"/></form>}',
            input.batch.sourceToken,
          );
        }

        return JSON.stringify({ status, summary: '无需改动', files: [] });
      });
      const retain = vi.fn();
      const result = await createBatchedModel(request, { guard() {}, retain })(
        'generate',
        task(),
        new AbortController().signal,
      );
      expect(parsePatch(result, {}).files[0].path).toBe('src/Form.tsx');
      expect(request).toHaveBeenCalledTimes(4);
      expect(retain).toHaveBeenCalledOnce();
    },
  );

  it('does not force a source rewrite for a valid unchanged existing file', async () => {
    const request = vi.fn(async (phase) =>
      phase === 'manifest'
        ? JSON.stringify({
            status: 'changed',
            summary: '检查',
            files: [{ path: 'src/Form.tsx', instruction: '确认表单' }],
          })
        : JSON.stringify({ status: 'unchanged', summary: '当前已有表单满足要求', files: [] }),
    );
    const result = await createBatchedModel(request, { guard() {} })(
      'generate',
      task({ 'src/Form.tsx': 'existing' }),
      new AbortController().signal,
    );
    expect(parsePatch(result, {}).status).toBe('unchanged');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('round-trips literal quotes, backslashes, nested JSON and non-ASCII without guessing escapes', () => {
    const source =
      'export const view = <input placeholder="预算" pattern="\\d+"/>;\nexport const example = {"goal":"增长"};\n';
    expect(parsePatch(bindFileSourceResponse(frame(source), 'src/Form.tsx', token), {}).files).toEqual([
      { path: 'src/Form.tsx', content: source },
    ]);
  });

  it.each([
    'unframed source',
    frame('x').replace(sourceEnvelope(token).end, ''),
    `Explanation\n${frame('x')}`,
    `${frame('x')}\nExplanation`,
    frame(''),
    frame('```tsx\nconst x = 1;\n```'),
    frame(sourceEnvelope(token).end),
    frame('x', '7ac54b82-945d-44cb-9024-9b1e3379a5a3'),
    `${frame('x')}\n${frame('y')}`,
  ])('rejects incomplete, ambiguous or foreign envelopes: %s', (raw) => {
    expect(() => bindFileSourceResponse(raw, 'src/Form.tsx', token)).toThrow();
  });

  it('retains the normal protected path, configuration and file-size gates', () => {
    expect(() => bindFileSourceResponse(frame('x'), '../evil.ts', token)).toThrow();
    expect(() => parsePatch(bindFileSourceResponse(frame('x'.repeat(250001)), 'src/Form.tsx', token), {})).toThrow();
    expect(() =>
      parsePatch(bindFileSourceResponse(frame('{}'), 'tsconfig.json', token), { 'tsconfig.json': '{"strict":true}' }),
    ).toThrow();
  });

  it('changes format only for the broken file, preserves candidates and completes the next file', async () => {
    const before = { 'src/Form.tsx': 'old form', 'src/App.tsx': 'old app' };
    const retained: Record<string, string>[] = [];
    const diagnostics = vi.fn();
    const request = vi.fn(async (phase, input) => {
      if (phase === 'manifest') {
        return manifest;
      }

      const path = input.batch.files[0].path;

      if (path === 'src/Form.tsx') {
        if (input.batch.sourceToken) {
          return frame('export const form = <input placeholder="预算"/>;', input.batch.sourceToken);
        }

        return '{"status":"changed","summary":"表单","content":"<input placeholder="预算"/>"}';
      }

      expect(input.files['src/Form.tsx']).toContain('placeholder="预算"');

      return JSON.stringify({ status: 'changed', summary: '接入', content: 'new app' });
    });
    const result = await createBatchedModel(request, {
      guard() {},
      diagnostic: diagnostics,
      retain: async (candidate) => {
        retained.push(candidate);
      },
    })('generate', task(before), new AbortController().signal);
    expect(parsePatch(result, before).files).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(5); // Manifest, JSON, JSON correction, source recovery, next file.
    expect(retained).toHaveLength(2);
    expect(diagnostics.mock.calls.map((call) => call[1])).toEqual(['patch_json', 'patch_json']);
    expect(before['src/Form.tsx']).toBe('old form');
  });

  it('bounds failed source recovery without endlessly rewriting or retaining partial data', async () => {
    const request = vi.fn(async (phase) => (phase === 'manifest' ? manifest : '{"content":'));
    const retain = vi.fn();
    await expect(
      createBatchedModel(request, { guard() {}, retain })(
        'generate',
        task({ 'src/Form.tsx': 'old', 'src/App.tsx': 'old' }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ category: 'batch-format', message: expect.stringContaining('file_envelope') });
    expect(request).toHaveBeenCalledTimes(4);
    expect(retain).not.toHaveBeenCalled();
  });

  it('does not bypass the shared budget for the source fallback', async () => {
    const request = vi.fn(async (phase) => (phase === 'manifest' ? manifest : '{}'));
    await expect(
      createBatchedModel(request, { guard() {}, maxCalls: 3 })(
        'generate',
        task({ 'src/Form.tsx': 'old' }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ category: 'batch-budget' });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each(['abort', 'source-change'])('does not retain a late recovered file after %s', async (condition) => {
    const before = { 'src/Form.tsx': 'old form', 'src/App.tsx': 'old app' };
    const controller = new AbortController();
    const retain = vi.fn();
    const request = vi.fn(async (phase, payload) => {
      if (phase === 'manifest') {
        return manifest;
      }

      if (!payload.batch.sourceToken) {
        return '{}';
      }

      if (condition === 'abort') {
        controller.abort();
      } else {
        before['src/Form.tsx'] = 'manual changes';
      }

      return frame('export const x = 1;', payload.batch.sourceToken);
    });
    await expect(
      createBatchedModel(request, { guard() {}, retain, capture: () => before })(
        'generate',
        task({ ...before }),
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(retain).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('never salvages even a well-framed response when the transport says output was truncated', async () => {
    const nativeFetch = globalThis.fetch;
    const response = `0:${JSON.stringify(frame('export const x=1;'))}\nd:{"finishReason":"length"}\n`;
    globalThis.fetch = vi.fn(async () => new Response(response));

    try {
      await expect(
        managedModelRequest(
          'generate',
          {
            ...task(),
            batch: {
              id: 1,
              files: [{ path: 'src/Form.tsx', instruction: '表单' }],
              recovery: true,
              sourceToken: token,
            },
          },
          { model: 'fixture', provider: 'Bailian', signal: new AbortController().signal },
        ),
      ).rejects.toBeInstanceOf(OutputLimitError);

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.managedFileOutput).toBe('source');
      expect(body.managedSingleFile).toBe(true);
      expect(body.messages[0].content).toContain(sourceEnvelope(token).end);
      expect(body.messages[0].content).not.toContain('changedResponse');
    } finally {
      globalThis.fetch = nativeFetch;
    }
  });

  it('keeps all safety/capability instructions but removes conflicting JSON response instructions', () => {
    const prompt = managedSystemPrompt('repair', false, true, true, 'source', true);
    expect(prompt).toContain('SINGLE-FILE SOURCE RECOVERY');
    expect(prompt).toContain('Never include secrets');
    expect(prompt).toContain('Do not weaken type checks');
    expect(prompt).toContain('PROVISIONED APPLICATION AUTH');
    expect(prompt).not.toContain('ONLY valid JSON');
    expect(prompt).not.toContain('"files":');
  });
});
