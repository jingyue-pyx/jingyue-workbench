import { afterEach, describe, expect, it, vi } from 'vitest';
import { managedModelRequest } from './model-client';
import { parsePlan, managedSystemPrompt } from './protocol';
import { createBatchedModel } from './file-batches';

afterEach(() => vi.unstubAllGlobals());

describe('managed model request', () => {
  it('makes repair scheduling distinct from reimplementing the original project', async () => {
    const fetch = vi.fn(async () => new Response('0:"{}"\nd:{"finishReason":"stop"}\n'));
    vi.stubGlobal('fetch', fetch);
    await managedModelRequest(
      'manifest',
      {
        task: '创建作品集全部模块',
        operation: 'repair',
        files: { 'src/Modal.tsx': 'current' },
        errors: ['src/Modal.tsx TS2322'],
      },
      { provider: 'Bailian', model: 'fixture', signal: new AbortController().signal },
    );

    const request = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const payload = JSON.parse(request.messages[0].content.slice(request.messages[0].content.indexOf('{')));
    expect(payload.task).toContain('最小修复清单');
    expect(payload.projectGoal).toBe('创建作品集全部模块');
    expect(payload.repairContract.currentDiagnostics).toEqual(['src/Modal.tsx TS2322']);
    expect(payload.files['src/Modal.tsx']).toBe('current');
  });
  it.each([
    ['minute', '60', 'model_rate_limit', true, 60000],
    ['minute', '3', 'model_rate_limit', true, 3000],
    ['minute', 'invalid', 'model_rate_limit', true, 60000],
    ['daily', '60', 'model_daily_limit', false, 0],
    ['unknown', '60', 'model_limit', false, 0],
  ])(
    'distinguishes the gateway limit %s without echoing response content',
    async (kind, seconds, reason, retryable, retryAfterMs) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response('private-canary', {
              status: 429,
              headers: { 'X-Jingyue-Model-Limit': String(kind), 'Retry-After': String(seconds) },
            }),
        ),
      );
      await expect(
        managedModelRequest(
          'plan',
          { task: '页面', files: {}, errors: [] },
          { model: 'fixture', provider: 'Bailian', signal: new AbortController().signal },
        ),
      ).rejects.toMatchObject({ reason, retryable, retryAfterMs });
    },
  );
  it.each([
    [401, 'session_expired', false],
    [403, 'request_denied', false],
    [429, 'model_limit', false],
    [400, 'model_request', false],
    [413, 'model_request', false],
    [501, 'model_request', false],
    [408, 'model_unavailable', true],
    [500, 'model_unavailable', true],
    [502, 'model_unavailable', true],
    [503, 'model_unavailable', true],
    [504, 'model_unavailable', true],
  ])(
    'maps HTTP %s to an explicit recovery policy without reading response secrets',
    async (status, reason, retryable) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('private-canary', { status: Number(status) })),
      );
      await expect(
        managedModelRequest(
          'plan',
          { task: '页面', files: {}, errors: [] },
          {
            model: 'fixture',
            provider: 'Bailian',
            signal: new AbortController().signal,
          },
        ),
      ).rejects.toMatchObject({ reason, retryable });
    },
  );

  it.each([
    ['JINGYUE_MODEL_AUTH', 'model_auth', false],
    ['JINGYUE_MODEL_REQUEST', 'model_request', false],
    ['JINGYUE_MODEL_UNAVAILABLE', 'model_unavailable', true],
    ['JINGYUE_MODEL_UNKNOWN', 'model_unknown', false],
  ])('retains provider code %s for the scheduler instead of flattening it', async (code, reason, retryable) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(`3:${JSON.stringify(code)}\n`)),
    );
    await expect(
      managedModelRequest(
        'plan',
        { task: '页面', files: {}, errors: [] },
        {
          model: 'fixture',
          provider: 'Bailian',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ reason, retryable });
  });

  it('discards interrupted text before retrying the same counted request', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('0:"broken-partial"\n'))
      .mockResolvedValueOnce(new Response('0:"complete-result"\nd:{"finishReason":"stop"}\n'));
    vi.stubGlobal('fetch', fetch);

    const request = createBatchedModel(
      (phase, input, signal) =>
        managedModelRequest(phase, input, {
          model: 'fixture',
          provider: 'Bailian',
          signal,
        }),
      { guard: () => {}, wait: async () => {} },
    );
    await expect(request('plan', { task: '页面', files: {}, errors: [] }, new AbortController().signal)).resolves.toBe(
      'complete-result',
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a content policy stop as a connection failure or code correction', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('d:{"finishReason":"content-filter"}\n')),
    );
    await expect(
      managedModelRequest(
        'plan',
        { task: '页面', files: {}, errors: [] },
        {
          model: 'fixture',
          provider: 'Bailian',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ reason: 'model_policy', retryable: false });
  });
  it('ends an overflow manifest request with a target-only extraction contract', async () => {
    const fetch = vi.fn(async () => new Response('0:"{}"\nd:{"finishReason":"stop"}\n'));
    vi.stubGlobal('fetch', fetch);
    await managedModelRequest(
      'manifest',
      {
        task: '营销 Agent 工作台',
        files: { 'src/App.tsx': 'existing source' },
        errors: [],
        decomposition: { target: { path: 'src/App.tsx', instruction: '保留表单和结果交互' }, maxNewFiles: 4 },
      },
      { provider: 'Bailian', model: 'fixture', signal: new AbortController().signal },
    );

    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const message = body.messages[0].content;
    const payload = JSON.parse(message.slice(message.indexOf('{')));
    expect(body.managedPhase).toBe('manifest');
    expect(body.managedSingleFile).toBeUndefined();
    expect(payload.outputContract.targetPath).toBe('src/App.tsx');
    expect(payload.outputContract.maxNewFiles).toBe(4);
    expect(payload.outputContract.response.files.at(-1).path).toBe('src/App.tsx');
    expect(managedSystemPrompt('manifest')).toContain('OVERFLOW DECOMPOSITION');
  });
  it.each([false, true])('scopes response examples to the actual CSS batch (exact edits: %s)', async (large) => {
    const fetch = vi.fn(async () => new Response('0:"{}"\nd:{"finishReason":"stop"}\n'));
    vi.stubGlobal('fetch', fetch);
    await managedModelRequest(
      'generate',
      {
        task: '同时修改 App 和 CSS',
        files: { 'src/style.css': 'button{}', 'src/App.tsx': 'old app' },
        errors: [],
        batch: {
          id: 2,
          files: [{ path: 'src/style.css', instruction: '补充样式' }],
          recovery: false,
          editOnlyPaths: large ? ['src/style.css'] : [],
        },
      },
      { provider: 'Bailian', model: 'fixture', signal: new AbortController().signal },
    );

    const request = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(request.managedFileOutput).toBe(large ? 'edits' : 'content');
    expect(request.managedSingleFile).toBe(true);

    const content = request.messages[0].content;
    const contract = JSON.parse(content.slice(content.indexOf('{'))).outputContract;
    expect(contract.targetPath).toBe('src/style.css');
    expect(contract.changedResponse).toHaveProperty(large ? 'edits' : 'content');
    expect(contract.changedResponse).not.toHaveProperty(large ? 'content' : 'edits');
    expect(contract.changedResponse).not.toHaveProperty('files');
    expect(JSON.stringify(contract)).not.toContain('src/App.tsx');
    expect(contract.instruction).toContain('新文件不可跳过');
  });
  it('uses an unambiguous complete-file server prompt for recovery instead of suggesting edits again', async () => {
    const fetch = vi.fn(async () => new Response('0:"{}"\nd:{"finishReason":"stop"}\n'));
    vi.stubGlobal('fetch', fetch);
    await managedModelRequest(
      'generate',
      {
        task: '修复两文件',
        files: { 'src/App.tsx': 'x'.repeat(7000) },
        errors: ['此前片段匹配失败'],
        fullFilePaths: ['src/App.tsx'],
        batch: { id: 2, recovery: true, files: [{ path: 'src/App.tsx', instruction: '改标题' }], editOnlyPaths: [] },
      },
      { provider: 'Bailian', model: 'fixture', signal: new AbortController().signal },
    );

    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.managedFileOutput).toBe('content');
    expect(body.managedBatchMode).toBe('recovery');

    const prompt = managedSystemPrompt('generate', false, false, false, body.managedFileOutput, body.managedSingleFile);
    expect(prompt).toContain('REQUIRED COMPLETE-FILE OUTPUT');
    expect(prompt).toContain('SINGLE-FILE RESPONSE CONTRACT');
    expect(prompt).not.toMatch(/PREFER|REQUIRED LARGE-FILE|use minimal exact edits|"edits":/);
    expect(prompt).not.toContain('"files":');
    expect(prompt).toContain('Do not weaken type checks');
    expect(prompt).toContain('Never include secrets');
    expect(managedSystemPrompt('generate', false, false, false, 'edits')).toContain('REQUIRED LARGE-FILE');
  });
  it.each([
    ['JINGYUE_MODEL_NETWORK', 'network', '连接中断'],
    ['JINGYUE_MODEL_LIMIT', 'quota', '额度'],
    ['An error occurred. private-canary', 'model-service', '原因尚未确认'],
  ])('preserves safe provider stream failure %s without requesting code repair', async (code, category, message) => {
    const fetch = vi.fn(async () => new Response(`3:${JSON.stringify(code)}\n`));
    vi.stubGlobal('fetch', fetch);
    await expect(
      managedModelRequest(
        'intent',
        { task: '修改', files: {}, errors: [] },
        {
          provider: 'Bailian',
          model: 'fixture',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ category, repairable: false, message: expect.stringContaining(message) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
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
    expect(payload.outputContract.targetPath).toBe('src/App.tsx');
    expect(payload.targetFile.path).toBe('src/App.tsx');
    expect(message.lastIndexOf('outputContract')).toBeGreaterThan(message.indexOf('"files"'));
  });
  it('separates the single-file task from bounded historical context in code batches', async () => {
    const fetch = vi.fn(async () => new Response('0:"{}"\nd:{"finishReason":"stop"}\n'));
    vi.stubGlobal('fetch', fetch);

    const history = [{ id: 'old', role: 'user' as const, content: 'stale-history-canary' }];
    await managedModelRequest(
      'generate',
      {
        task: '两个文件都必须改动',
        files: { 'src/App.tsx': 'current app', 'src/style.css': 'button{}' },
        errors: [],
        batch: {
          id: 2,
          recovery: false,
          files: [{ path: 'src/style.css', instruction: '按钮改绿' }],
          editOnlyPaths: [],
        },
      },
      { provider: 'Bailian', model: 'fixture', signal: new AbortController().signal, history },
    );

    const request = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const message = request.messages[0].content;
    const input = JSON.parse(message.slice(message.indexOf('{')));
    expect(input.task).toBe('只完成当前文件 src/style.css：按钮改绿');
    expect(input.projectGoal).toBe('两个文件都必须改动');
    expect(input.files[input.targetFile.path]).toBe('button{}');
    expect(input.files['src/App.tsx']).toBe('current app');
    expect(input.conversation).toEqual([{ role: 'user', content: 'stale-history-canary' }]);
    expect(input.conversationContext.scope).toBe('current-project-history');
    expect(input.outputContract.targetPath).toBe('src/style.css');
    expect(input.conversationContext.activeTask).toBeUndefined();
  });
  it.each(['intent', 'answer', 'plan', 'manifest', 'generate', 'repair'] as const)(
    'carries the active task and failed result into every %s request',
    async (phase) => {
      const fetch = vi.fn(async () => new Response('0:"{}"\nd:{"finishReason":"stop"}\n'));
      vi.stubGlobal('fetch', fetch);

      const history = [
        { id: 'create', role: 'user' as const, content: '创建作品集，不编造奖项', annotations: ['managed-task'] },
        {
          id: 'fail',
          role: 'assistant' as const,
          content: '运行环境未就绪',
          annotations: ['managed-outcome:failed:idle:sandbox:0'],
        },
        ...Array.from({ length: 16 }, (_, i) => ({ id: String(i), role: 'assistant' as const, content: '历史讨论' })),
        { id: 'continue', role: 'user' as const, content: '继续再试试呢' },
      ];
      await managedModelRequest(
        phase,
        {
          task: '继续再试试呢',
          files: { 'src/App.tsx': 'current source' },
          errors: [],
          ...(['generate', 'repair'].includes(phase)
            ? { batch: { id: 1, recovery: false, files: [{ path: 'src/App.tsx', instruction: '接续作品集' }] } }
            : {}),
        },
        { provider: 'Bailian', model: 'fixture', history, signal: new AbortController().signal },
      );

      const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
      const input = JSON.parse(body.messages[0].content.slice(body.messages[0].content.indexOf('{')));
      expect(input.conversationContext.activeTask).toBe('创建作品集，不编造奖项');
      expect(input.conversationContext.latestOutcome.reason).toBe('浏览器运行环境未就绪');
      expect(input.conversation.at(-1).content).toBe('继续再试试呢');
      expect(input.files['src/App.tsx']).toBe('current source');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
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
    ).rejects.toMatchObject({
      name: 'ModelRequestError',
      reason: 'model_incomplete',
      category: 'model-output',
      repairable: false,
    });
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
      message: expect.stringContaining('模型连接中断'),
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
    ).rejects.toMatchObject({ category: 'model-output', reason: 'model_incomplete', repairable: false });
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
