import { describe, expect, it } from 'vitest';
import { candidateContext, recoveryTask, restoreCandidate } from './candidate-recovery';
import { parsePlan } from './protocol';

const task = '帮我创建一个作品集';
const plan = parsePlan(JSON.stringify({ goal: '作品集', steps: ['生成并验证'], supported: true }));
const files = { 'src/App.tsx': 'export default () => <main>Portfolio</main>' };
describe('candidate recovery binding', () => {
  it('restores only the same task, live base and exact retained candidate', async () => {
    const context = await candidateContext(task, {}, files, plan);
    expect(await restoreCandidate(task, {}, files, context)).toMatchObject({ files, plan });
    expect(await restoreCandidate('创建商城', {}, files, context)).toBeUndefined();
    expect(await restoreCandidate(task, { 'src/App.tsx': 'new user edit' }, files, context)).toBeUndefined();
    expect(await restoreCandidate(task, {}, { ...files, 'src/B.tsx': 'partial next batch' }, context)).toBeUndefined();
    expect(await restoreCandidate(task, {}, files)).toBeUndefined();
    expect(await restoreCandidate(task, {}, files, { ...context, plan: 'broken' })).toBeUndefined();
  });
  it('normalizes only the system continuation suffix, never user changes', async () => {
    const suffix = '\n继续此前任务，保留现有草稿，检查并修复未通过的问题。';
    expect(recoveryTask(task + suffix + suffix)).toBe(task);

    const context = await candidateContext(task + suffix, {}, files, plan);
    expect(await restoreCandidate(task + suffix + suffix, {}, files, context)).toBeDefined();
    expect(await restoreCandidate(task + '并添加登录' + suffix, {}, files, context)).toBeUndefined();
  });
});
