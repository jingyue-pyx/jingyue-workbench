import { describe, expect, it } from 'vitest';
import {
  enforceTaskCapabilities,
  APP_AUTH_BOUNDARY,
  requiresRealAppAuth,
  validateAppAuthIntegration,
} from './capabilities';
import { managedSystemPrompt, parsePlan } from './protocol';

const plan = parsePlan(JSON.stringify({ goal: '登录注册', supported: true, steps: ['生成页面'], backendMode: 'mock' }));

describe('generated app capability boundary', () => {
  it('describes provisioned auth consistently in planning, batched generation and repair', () => {
    for (const phase of ['plan', 'manifest', 'generate', 'repair'] as const) {
      expect(managedSystemPrompt(phase, false, false, true)).toContain('PROVISIONED APPLICATION AUTH');
      expect(managedSystemPrompt(phase, false, false, true)).toContain('useAppAuth');
      expect(managedSystemPrompt(phase)).not.toContain('PROVISIONED APPLICATION AUTH');
    }
  });
  it('accepts only provisioned real authentication and requires generated code to connect the helper', () => {
    const task = '创建一个登录注册页面，账号存数据库';
    const connected = { ...plan, backendMode: 'external-api' as const };
    expect(enforceTaskCapabilities(task, connected, true)).toBe(connected);
    expect(() => enforceTaskCapabilities(task, plan, true)).toThrow('useAppAuth');
    expect(() => validateAppAuthIntegration(task, { 'src/App.tsx': 'export default () => null' }, true)).toThrow(
      '真实登录未接入',
    );
    expect(() =>
      validateAppAuthIntegration(
        task,
        {
          'src/App.tsx':
            "import {useAppAuth} from './lib/jingyue-auth'; export default function App(){const auth=useAppAuth();return null;}",
        },
        true,
      ),
    ).not.toThrow();
  });
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
    '直接生成一个纯静态 React + Vite 中文网页。用途是合成测试，不包含个人数据、登录注册、数据库、工作台预览专用认证或存储接口。只需三个能力卡片和一个计数器。',
    '生成产品目录，不包含登录、注册和数据库',
    '不接入登录注册、后端或数据库，只做前端页面',
    'Create a static page without login, registration or a database.',
    'Create login and registration mockups, no database or backend required.',
    '创建注册页面，不需要登录，但数据需要保存到数据库',
  ])('does not reject frontend prototypes or unrelated document storage: %s', (task) => {
    expect(requiresRealAppAuth(task)).toBe(false);
    expect(enforceTaskCapabilities(task, plan)).toBe(plan);
    expect(enforceTaskCapabilities(task, plan, true)).toBe(plan);
    expect(() => validateAppAuthIntegration(task, { 'src/App.tsx': 'export default () => null' }, true)).not.toThrow();
  });
  it.each([
    '不需要数据库，但需要真实登录注册',
    '不要模拟登录注册，要连接真实数据库',
    '不要图片和外部接口，需要注册登录，账号存数据库',
    '不包含数据库管理页面，但需要真实登录和注册',
    'No mock authentication; create login and registration backed by a database.',
    'Without a database management screen, implement real authentication with login and registration.',
  ])('preserves explicit positive authentication requirements after an exclusion: %s', (task) => {
    expect(requiresRealAppAuth(task)).toBe(true);
    expect(() => enforceTaskCapabilities(task, plan, true)).toThrow('useAppAuth');
  });
});
