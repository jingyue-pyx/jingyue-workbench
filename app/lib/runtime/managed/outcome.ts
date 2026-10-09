import { BATCH_FAILURE_REASONS } from './batch-failure';
import { FAILURE_REASONS } from './failure-code';
import { STOP_REASONS } from './stop-cause';
import { MANAGED_MAX_REPAIRS } from './request-policy';

/*
 * Only finite, public descriptions belong in saved-result presentation. Never
 * render raw diagnostics, source fragments or arbitrary annotation values.
 */
const stages: Record<string, string> = {
  planning: '方案整理',
  reviewing: '方案确认',
  generating: '代码生成',
  applying: '文件写入',
  installing: '依赖安装',
  typechecking: 'TypeScript 类型检查',
  building: '正式构建',
  starting: '预览服务启动',
  previewing: '预览连接检查',
  repairing: '自动修复',
  idle: '准备',
};
const reasons: Record<string, string> = {
  ...STOP_REASONS,
  ...BATCH_FAILURE_REASONS,
  ...FAILURE_REASONS,
  capability: '需求所需的后端能力尚未接入，尚未执行代码生成或编译',
  plan_format: '模型返回的方案格式不完整',
  plan_clarification: '方案出现重复追问',
  quota: '模型额度或频率限制已触发',
  authentication: '登录状态已失效',
  preview_connection: '预览连接未成功，不能据此判断代码有错',
  timeout: '操作超过等待时限',
  network: '网络或依赖服务连接失败',
  dependency_install: '依赖包安装不完整，需修复安装环境而非重新生成业务源码',
  compile: '生成的代码未通过类型或构建校验',
  style: '页面使用的样式类缺少对应样式支持',
  model_output: '模型没有返回完整、有效的文件改动',
  output_limit: '单文件输出仍被长度限制截断，分批和有限重试未能完成',
  batch_budget: '分批生成达到本次请求或输出预算',
  model_no_change: '模型没有提供实际代码改动，待修复问题仍未解决',
  model_service: '模型服务连接或响应失败，本次不完整文件未写入',
  sandbox: '浏览器运行环境未就绪',
  other: '尚未取得可归类的失败原因',
  none: '',
};

export function parseOutcomeAnnotation(annotation: unknown) {
  if (typeof annotation !== 'string') {
    return undefined;
  }

  const match = /^managed-outcome:(failed|succeeded|unchanged|cancelled):([a-z]+):([a-z_]+):(0|[1-9][0-9]?)$/.exec(
    annotation,
  );

  if (
    !match ||
    Number(match[4]) > MANAGED_MAX_REPAIRS ||
    !Object.hasOwn(stages, match[2]) ||
    !Object.hasOwn(reasons, match[3])
  ) {
    return undefined;
  }

  return {
    outcome: match[1],
    stage: stages[match[2]],
    reason: reasons[match[3]],
    attempt: Number(match[4]),
    reasonCode: match[3],
  };
}
