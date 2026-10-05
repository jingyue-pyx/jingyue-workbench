import { PlanValidationError, RunError, type SourceFiles, type TaskPlan } from './protocol';

export const APP_AUTH_BOUNDARY =
  '生成应用的真实账号认证尚未接入。现有 Supabase 能力只用于非敏感演示数据保存，不是注册、密码校验和登录会话服务；不能用 localStorage 或普通 JSON 存储替代。';

const chineseFeature =
  '(?:(?:真实|实际|真正|独立|远程)\\s*(?:的)?\\s*)?(?:个人数据|登录注册|注册登录|登入注册|注册登入|后端|数据库|服务端|账号认证|登录|登入|注册)';
const englishFeature =
  '(?:(?:a|an|any|real|actual|remote)\\s+)*(?:personal data|sign[ -]?in|sign[ -]?up|login|registration|register|database|backend|server|authentication)\\b';
const excludedChineseFeatures = new RegExp(
  `(?:不要|不用|无需|不需要|不实现|不接入|不包含|不涉及|不使用)\\s*${chineseFeature}(?:\\s*[、和及或与]\\s*${chineseFeature})*`,
  'g',
);
const excludedEnglishFeatures = new RegExp(
  `\\b(?:no|without|do not (?:need|include|use)|don't (?:need|include|use))\\s+${englishFeature}(?:\\s*(?:,\\s*(?:(?:and|or)\\s+)?|and\\s+|or\\s+)${englishFeature})*`,
  'gi',
);

/*
 * Real authentication is an explicitly provisioned server capability, separate
 * from demo document storage. Requirements survive planning and refinement.
 * Supporting a backend requires a provisioned capability, not supported=true
 * in model output. A separate, explicitly frontend-only task remains possible.
 */
export function requiresRealAppAuth(task: string) {
  const instruction = task.replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|「[^」]*」|"[^"\n]*"/g, '');

  /*
   * Remove only explicitly excluded capability names/list items, not the rest
   * of the sentence: a later "but use real authentication" must still count.
   */
  const positiveRequirement = instruction.replace(excludedChineseFeatures, '').replace(excludedEnglishFeatures, '');

  return (
    /登录|登入|\blogin\b|sign[ -]?in/i.test(positiveRequirement) &&
    /注册|\bregister|\bregistration\b|sign[ -]?up/i.test(positiveRequirement) &&
    /数据库|后端|服务端|真实(?:登录|登入|认证)|实际(?:存储|保存)|\bdatabase\b|real authentication/i.test(
      positiveRequirement,
    )
  );
}

export function enforceTaskCapabilities(task: string, plan: TaskPlan, appAuthEnabled = false): TaskPlan {
  const realAuth = requiresRealAppAuth(task);

  if (realAuth && appAuthEnabled && plan.supported && plan.backendMode !== 'external-api') {
    throw new PlanValidationError([
      'backendMode：此项目已提供真实应用认证，请使用 external-api 和 useAppAuth，不得改成模拟登录。',
    ]);
  }

  if (!realAuth || appAuthEnabled) {
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

export function validateAppAuthIntegration(task: string, files: SourceFiles, enabled: boolean) {
  if (!enabled || !requiresRealAppAuth(task)) {
    return;
  }

  const appFiles = Object.entries(files).filter(
    ([path]) => /\.[jt]sx?$/.test(path) && path !== 'src/lib/jingyue-auth.ts',
  );

  if (
    !appFiles.some(
      ([, content]) => /from\s*['"][^'"]*jingyue-auth(?:\.ts)?['"]/.test(content) && /\buseAppAuth\s*\(/.test(content),
    )
  ) {
    throw new RunError(
      '真实登录未接入：必须从 src/lib/jingyue-auth.ts 导入并使用 useAppAuth，注册、登录、会话恢复与退出必须使用此服务，不得以本地模拟代替。',
      true,
      'compile',
    );
  }
}
