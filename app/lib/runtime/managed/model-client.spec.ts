import { afterEach, describe, expect, it, vi } from 'vitest';
import { managedModelRequest } from './model-client';
import { parsePlan } from './protocol';

afterEach(() => vi.unstubAllGlobals());

describe('managed model request', () => {
  it('classifies a connection failure before response headers without leaking transport details', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('private upstream address'));
    vi.stubGlobal('fetch', fetch);
    await expect(
      managedModelRequest(
        'intent',
        { task: '修改页面', files: {}, errors: [] },
        {
          provider: 'Bailian',
          model: 'fixture',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ category: 'network', message: expect.stringContaining('模型连接中断') });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves cancellation before response headers without retrying', async () => {
    const controller = new AbortController();
    const reason = new Error('user stopped');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        controller.abort(reason);
        throw new TypeError('aborted transport');
      }),
    );
    await expect(
      managedModelRequest(
        'intent',
        { task: '修改页面', files: {}, errors: [] },
        {
          provider: 'Bailian',
          model: 'fixture',
          signal: controller.signal,
        },
      ),
    ).rejects.toBe(reason);
  });
  it('sends bounded batch mode and correlation separately from project contents', async () => {
    const fetch = vi.fn(async () => new Response('0:"{}"\nd:{"finishReason":"stop"}\n'));
    vi.stubGlobal('fetch', fetch);

    const runId = '8c1e4b17-f6e4-4d7a-9e29-a50174634828';
    const projectId = 'd63cb19b-9fef-4ae7-8855-293ad3fb2be2';
    await managedModelRequest(
      'repair',
      {
        task: '修复',
        files: {},
        errors: [],
        runId,
        attempt: 1,
        batch: { id: 3, files: [{ path: 'src/App.tsx', instruction: '修改入口' }], recovery: true },
      },
      { provider: 'Bailian', model: 'fixture', projectId, signal: new AbortController().signal },
    );

    const request = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(request.managedBatchMode).toBe('recovery');
    expect(request.managedTrace).toEqual({ projectId, runId, attempt: 1, batch: 3 });

    const message = request.messages[0].content;
    const payload = JSON.parse(message.slice(message.indexOf('{')));
    expect(payload.outputContract.files).toEqual([{ path: 'src/App.tsx', instruction: '修改入口' }]);
    expect(message.lastIndexOf('outputContract')).toBeGreaterThan(message.indexOf('"files"'));
  });
  it('distinguishes manifest truncation from an invalid engineering plan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('0:"partial"\nd:{"finishReason":"length"}\n')),
    );
    await expect(
      managedModelRequest(
        'manifest',
        { task: '修改', files: {}, errors: [] },
        {
          provider: 'Bailian',
          model: 'fixture',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ name: 'OutputLimitError', category: 'output-limit', repairable: false });
  });
  it('classifies only known planning truncation as a correctable plan validation error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('0:"partial"\nd:{"finishReason":"length"}\n')),
    );
    await expect(
      managedModelRequest(
        'plan',
        { task: '页面', files: {}, errors: [] },
        {
          provider: 'Bailian',
          model: 'fixture',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      name: 'PlanValidationError',
      category: 'plan-format',
      issues: [expect.stringContaining('截断')],
    });
  });
  it('does not mistake an unknown plan interruption for schema repair', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('0:"partial"\n')),
    );
    await expect(
      managedModelRequest(
        'plan',
        { task: '页面', files: {}, errors: [] },
        {
          provider: 'Bailian',
          model: 'fixture',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ name: 'RunError', category: 'model-output', repairable: false });
  });
  it('reports full-file truncation to the batch scheduler instead of the compile repair loop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('0:"partial"\nd:{"finishReason":"length"}\n')),
    );
    await expect(
      managedModelRequest(
        'repair',
        {
          task: '修复',
          files: {},
          errors: [],
          fullFilePaths: ['src/App.tsx'],
        },
        { provider: 'Bailian', model: 'fixture', signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({
      category: 'output-limit',
      repairable: false,
      name: 'OutputLimitError',
    });
  });
  it('passes full-file recovery paths to the model with the unchanged source snapshot', async () => {
    const fetch = vi.fn(async () => new Response('0:"{}"\nd:{"finishReason":"stop"}\n'));
    vi.stubGlobal('fetch', fetch);
    await managedModelRequest(
      'repair',
      {
        task: '修复',
        files: { 'src/App.tsx': 'current' },
        errors: ['search mismatch'],
        fullFilePaths: ['src/App.tsx'],
      },
      { provider: 'Bailian', model: 'fixture', signal: new AbortController().signal },
    );

    const request = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const payload = JSON.parse(request.messages[0].content.slice(request.messages[0].content.indexOf('{')));
    expect(payload.fullFilePaths).toEqual(['src/App.tsx']);
    expect(payload.files['src/App.tsx']).toBe('current');
  });
  it.each(['intent', 'answer'] as const)(
    'sends the current source in %s, not only conversation metadata',
    async (phase) => {
      const fetch = vi.fn(async () => new Response('0:"已读取当前源码"\nd:{"finishReason":"stop"}\n'));
      vi.stubGlobal('fetch', fetch);

      const files = {
        'src/App.tsx':
          'function ExperienceButton() { return <button onClick={() => alert("演示")}>体验 Demo</button> }',
        'package.json': '{"scripts":{"dev":"vite"}}',
        'package-lock.json': 'exclude dependency lock from model context',
      };
      await managedModelRequest(
        phase,
        { task: '你自己不能读取吗', files, errors: [] },
        {
          provider: 'Bailian',
          model: 'fixture',
          signal: new AbortController().signal,
          projectId: 'current-project',
          history: [{ id: 'old', role: 'assistant', content: '旧回答：没有源码' }],
        },
      );

      const request = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
      const payload = JSON.parse(request.messages[0].content.slice(request.messages[0].content.indexOf('{')));
      expect(payload.files['src/App.tsx']).toBe(files['src/App.tsx']);
      expect(payload.files['package-lock.json']).toBeUndefined();
      expect(request.managedProjectId).toBe('current-project');
      expect(request.managedPhase).toBe(phase);
    },
  );
  it('explains a broken response stream without exposing raw transport errors', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new TypeError('private transport diagnostic'));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream)),
    );
    await expect(
      managedModelRequest(
        'generate',
        { task: '页面', files: {}, errors: [] },
        {
          provider: 'Bailian',
          model: 'fixture',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      message: '模型连接中断，未写入本次不完整文件；已有源码保留，请重试。',
      repairable: false,
    });
  });
  it('classifies truncation without returning partial files or triggering whole-task retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('0:"partial"\nd:{"finishReason":"length"}\n')),
    );
    await expect(
      managedModelRequest(
        'generate',
        { task: '样式', files: {}, errors: [] },
        {
          provider: 'Bailian',
          model: 'fixture',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ category: 'output-limit', repairable: false });
  });
  it('does not retry unknown interrupted streams as if they were token truncation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('0:"partial"\n')),
    );
    await expect(
      managedModelRequest(
        'generate',
        { task: '样式', files: {}, errors: [] },
        {
          provider: 'Bailian',
          model: 'fixture',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ category: 'model-output', repairable: false });
  });
  it('reports actual received output without publishing source or executing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('0:"first"\n0:"second"\nd:{"finishReason":"stop"}\n')),
    );

    const onProgress = vi.fn();
    const result = await managedModelRequest(
      'generate',
      { task: '页面', files: {}, errors: [] },
      {
        provider: 'Bailian',
        model: 'fixture',
        signal: new AbortController().signal,
        onProgress,
      },
    );
    expect(result).toBe('firstsecond');
    expect(onProgress).toHaveBeenLastCalledWith(11);
    expect(onProgress.mock.calls.every(([value]) => typeof value === 'number')).toBe(true);
  });
  it('marks answered planning as final synthesis and preserves the actual decisions', async () => {
    const fetch = vi.fn(async () => new Response('0:"{}"\nd:{"finishReason":"stop"}\n'));
    vi.stubGlobal('fetch', fetch);

    const plan = {
      ...parsePlan(JSON.stringify({ goal: '线索列表', steps: ['展示', '验证'], supported: true })),
      decisions: [{ question: '展示方式', answer: '卡片' }],
    };
    await managedModelRequest(
      'plan',
      { task: '列表', files: {}, errors: [], plan },
      {
        provider: 'Bailian',
        model: 'fixture',
        signal: new AbortController().signal,
      },
    );

    const request = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(request.managedPlanFinalization).toBe(true);
    expect(request.managedPhase).toBe('plan');
    expect(request.messages[0].content).toContain('卡片');
  });
});
