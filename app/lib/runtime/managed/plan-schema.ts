import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const choiceId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const uniqueIds = (items: { id: string }[]) => new Set(items.map((item) => item.id)).size === items.length;
const question = z.object({
  id: choiceId,
  title: text(300),
  options: z
    .array(z.object({ id: choiceId, label: text(100), description: z.string().max(500) }))
    .min(2)
    .max(4)
    .refine(uniqueIds, '选项 id 不得重复'),
});

/*
 * One runtime schema for both first drafts and refined plans. No coercion:
 * e.g. the string "false" must never authorize an unsupported project.
 */
export const taskPlanSchema = z
  .object({
    goal: text(500),
    supported: z.boolean(),
    reason: z.string().max(500).optional(),
    steps: z.array(text(1000)).max(16).optional(),
    modules: z
      .array(
        z.object({
          name: text(100),
          description: text(1000),
          scope: z.enum(['frontend', 'mock', 'future-backend']),
        }),
      )
      .max(12)
      .optional(),
    backendMode: z.enum(['none', 'mock', 'external-api', 'required']).default('none'),
    backendNotes: text(1500).optional(),
    dataStrategy: text(1500).optional(),
    acceptance: z.array(text(1000)).max(12).optional(),
    limitations: z.array(text(1000)).max(12).optional(),
    questions: z.array(question).max(3).refine(uniqueIds, '问题 id 不得重复').default([]),
  })
  .superRefine((plan, context) => {
    // A clarification may defer execution details. A final plan may not.
    if (!plan.questions.length) {
      if (!plan.steps?.length) {
        context.addIssue({ code: 'custom', path: ['steps'], message: '必须提供非空执行步骤' });
      }

      if (plan.modules && !plan.modules.length) {
        context.addIssue({ code: 'custom', path: ['modules'], message: '必须提供非空模块定义' });
      }
    }
  });

const fields: Record<string, string> = {
  goal: '任务目标',
  supported: '支持范围标记',
  reason: '范围说明',
  steps: '执行步骤',
  modules: '模块定义',
  name: '名称',
  description: '说明',
  scope: '模块范围',
  backendMode: '后端范围',
  backendNotes: '后端说明',
  dataStrategy: '数据策略',
  acceptance: '验收清单',
  limitations: '限制清单',
  questions: '方案问题',
  options: '方案选项',
  id: '标识',
  title: '标题',
  label: '选项名称',
};

/*
 * Feedback is derived from the schema, never from model values or raw Zod
 * messages (which may embed an invalid value). Safe to display and retry with.
 */
export function planSchemaIssues(issues: z.ZodIssue[]): string[] {
  return issues.slice(0, 8).map((issue) => {
    const path = issue.path
      .map((key) => (typeof key === 'number' ? `[${key}]` : Object.hasOwn(fields, key) ? key : 'field'))
      .join('.');
    const label = fields[String(issue.path[0])] || '方案';
    const constraint =
      issue.code === 'invalid_type'
        ? `必须为 ${issue.expected}`
        : issue.code === 'too_small'
          ? `长度或数量至少为 ${issue.minimum}`
          : issue.code === 'too_big'
            ? `长度或数量不得超过 ${issue.maximum}`
            : issue.code === 'invalid_enum_value'
              ? '必须使用规定的枚举值'
              : issue.code === 'custom'
                ? issue.message
                : '格式不符合约束';

    return `${label}${path ? `（${path}）` : ''}：${constraint}`;
  });
}
