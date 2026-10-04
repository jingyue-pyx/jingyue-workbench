import type { TaskPlan } from './protocol';

export const APP_AUTH_BOUNDARY =
  '生成应用的真实账号认证尚未接入。现有 Supabase 能力只用于非敏感演示数据保存，不是注册、密码校验和登录会话服务；不能用 localStorage 或普通 JSON 存储替代。';

/*
 * This runner has a bounded document store, not an app authentication service.
 * An explicit real-auth requirement must survive model planning and refinement.
 * Supporting another backend requires a provisioned capability, not supported=true
 * in model output. A separate, explicitly frontend-only task remains possible.
 */
export function enforceTaskCapabilities(task: string, plan: TaskPlan): TaskPlan {
  const instruction = task.replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|「[^」]*」|"[^"\n]*"/g, '');
  const positiveRequirement = instruction.replace(
    /(?:不要|不用|无需|不需要|不实现|不接入)\s*(?:真实|实际|真正)?\s*(?:的)?(?:后端|数据库|服务端|账号认证|登录|登入)/g,
    '',
  );
  const realAuth =
    /登录|登入|\blogin\b|sign[ -]?in/i.test(instruction) &&
    /注册|\bregister|sign[ -]?up/i.test(instruction) &&
    /数据库|后端|服务端|真实(?:登录|登入|认证)|实际(?:存储|保存)|\bdatabase\b|real authentication/i.test(
      positiveRequirement,
    );

  if (!realAuth) {
    return plan;
  }

  return {
    ...plan,
    goal: '登录与注册页面（真实账号认证待接入）',
    supported: false,
    backendMode: 'required',
    reason: APP_AUTH_BOUNDARY,
    questions: [],
  };
}
