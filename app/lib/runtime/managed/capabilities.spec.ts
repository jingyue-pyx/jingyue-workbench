import { describe, expect, it } from 'vitest';
import { enforceTaskCapabilities, APP_AUTH_BOUNDARY } from './capabilities';
import { parsePlan } from './protocol';

const plan = parsePlan(JSON.stringify({ goal: '登录注册', supported: true, steps: ['生成页面'], backendMode: 'mock' }));

describe('generated app capability boundary', () => {
  it.each([
    '帮我创建一个登入合注册的页面要求注册的账号能够实际存储到数据库里面下一次登入不需要再次注册可以直接登入',
    '创建一个登录注册页面，注册数据保存在数据库',
    '创建一个注册和真实登录的页面',
    'Create a login and register page backed by a database',
  ])('does not accept a model claiming a mock satisfies real authentication: %s', (task) => {
    const result = enforceTaskCapabilities(task, plan);
    expect(result.supported).toBe(false);
    expect(result.backendMode).toBe('required');
    expect(result.reason).toBe(APP_AUTH_BOUNDARY);
    expect(result.goal).toBe('登录与注册页面（真实账号认证待接入）');
    expect(result.questions).toEqual([]);
  });
  it('does not let model refinement override the unchanged real backend requirement', () => {
    const refined = { ...plan, supported: true, decisions: [{ question: '模拟？', answer: '拒绝，需要真实后端' }] };
    expect(enforceTaskCapabilities('创建一个登录注册页面，账号存数据库', refined).supported).toBe(false);
  });
  it.each([
    '创建一个登录注册页面，仅前端展示，不需要真实数据库',
    '创建一个采购单表格，数据保存到数据库',
    '创建一个不需要登录的产品目录',
  ])('does not reject frontend prototypes or unrelated document storage: %s', (task) => {
    expect(enforceTaskCapabilities(task, plan)).toBe(plan);
  });
});
