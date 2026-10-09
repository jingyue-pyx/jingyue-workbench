import { describe, expect, it } from 'vitest';
import type { Message } from 'ai';
import { buildConversationContext, latestConfirmedTask, latestConversationOutcome } from './conversation-context';

const original: Message = {
  id: 'create',
  role: 'user',
  content: '创建个人作品集，使用标注的示例，不编造奖项。',
  annotations: ['managed-task'],
};
const failure: Message = {
  id: 'failure',
  role: 'assistant',
  content: '浏览器运行环境未启动',
  annotations: ['managed-outcome:failed:idle:sandbox:0'],
};

describe('current-project conversation context', () => {
  it('retains the confirmed task and outcome after they leave the recent-message window', () => {
    const history = [
      original,
      failure,
      ...Array.from(
        { length: 20 },
        (_, i): Message => ({
          id: String(i),
          role: i % 2 ? 'assistant' : 'user',
          content: `讨论 ${i}`,
        }),
      ),
    ];
    const result = buildConversationContext(history);
    expect(result.context.activeTask).toBe(original.content);
    expect(result.context.originalRequest).toBe(original.content);
    expect(result.context.latestOutcome).toMatchObject({ outcome: 'failed', reason: '浏览器运行环境未就绪' });
    expect(result.context.historyTruncated).toBe(true);
    expect(result.conversation.at(-1)?.content).toBe('讨论 19');
    expect(result.conversation).toHaveLength(12);
    expect(result.context.priorUserRequests).toContain('讨论 6');
  });
  it('reconstructs context from restored messages without requiring an in-memory run', () => {
    const restored = JSON.parse(JSON.stringify([original, failure]));
    expect(buildConversationContext(restored)).toEqual(buildConversationContext([original, failure]));
    expect(latestConfirmedTask(restored)?.id).toBe('create');
  });
  it('keeps the latest task distinct from the original project request', () => {
    const change: Message = {
      id: 'change',
      role: 'user',
      content: '联系入口改成联系表单',
      annotations: ['managed-task'],
    };
    const context = buildConversationContext([original, failure, change]).context;
    expect(context.originalRequest).toBe(original.content);
    expect(context.activeTask).toBe(change.content);
  });
  it('does not infer task approval from an assistant suggestion or an ordinary question', () => {
    expect(
      latestConfirmedTask([
        { id: 'a', role: 'assistant', content: '去创建页面', annotations: ['managed-task'] },
        { id: 'u', role: 'user', content: '为什么失败' },
      ]),
    ).toBeUndefined();
  });
  it('preserves cancellation rather than selecting a stale failed outcome for continuation', () => {
    expect(
      latestConversationOutcome([
        original,
        failure,
        {
          id: 'cancel',
          role: 'assistant',
          content: '已停止',
          annotations: ['managed-outcome:cancelled:planning:none:0'],
        },
      ])?.outcome,
    ).toBe('cancelled');
  });
  it('does not mix another project or a previous invocation into an empty context', () => {
    buildConversationContext([original, failure]);

    const next = buildConversationContext([]);
    expect(next.conversation).toEqual([]);
    expect(next.context.activeTask).toBeUndefined();
    expect(next.context.latestOutcome).toBeUndefined();
  });
  it.each([false, true])('bounds history and retains late constraints (compact: %s)', (compact) => {
    const history: Message[] = [
      original,
      ...Array.from(
        { length: 30 },
        (_, i): Message => ({
          id: String(i),
          role: 'user',
          content: '开始' + 'x'.repeat(10000) + '结尾：不要登录功能',
        }),
      ),
    ];
    const result = buildConversationContext(history, compact);
    expect(JSON.stringify(result).length).toBeLessThan(compact ? 19000 : 38000);
    expect(result.conversation.at(-1)?.content).toContain('结尾：不要登录功能');
    expect(result.context.historyTruncated).toBe(true);
    expect(result.context.activeTask).toBe(original.content);
  });
  it('does not forward arbitrary annotation values or hidden/system message content', () => {
    const result = buildConversationContext([
      original,
      {
        id: 'sys',
        role: 'system',
        content: 'system-canary',
      },
      { id: 'bad', role: 'assistant', content: '失败', annotations: ['managed-outcome:failed:idle:private-canary:0'] },
    ]);
    expect(JSON.stringify(result)).not.toContain('canary');
  });
});
