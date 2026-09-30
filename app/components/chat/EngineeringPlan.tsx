import { useEffect, useRef, useState } from 'react';
import { ENGINEERING_BOUNDARY, type PlanAnswers, type TaskPlan } from '~/lib/runtime/managed/protocol';
import styles from './EngineeringPlan.module.scss';

const scopeLabel = { frontend: '前端', mock: '模拟数据', 'future-backend': '后续扩展' };

export function EngineeringPlan({
  plan,
  reviewing,
  ready,
  onConfirm,
  onAdjust,
  reviewError,
}: {
  plan: TaskPlan;
  reviewing: boolean;
  ready: boolean;
  onConfirm: (answers?: PlanAnswers) => void;
  onAdjust: (feedback: string) => void;
  reviewError?: string;
}) {
  const [answers, setAnswers] = useState<PlanAnswers>({});
  const [adjusting, setAdjusting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [adjustmentError, setAdjustmentError] = useState('');
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const adjustButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (adjusting) {
      feedbackRef.current?.focus();
    }
  }, [adjusting]);

  const needsAnswers = plan.questions.length > 0;
  const answered = plan.questions.filter((question) =>
    question.options.some((option) => option.id === answers[question.id]),
  ).length;
  const complete = answered === plan.questions.length;

  return (
    <section aria-label="工程技术方案" className={styles.plan}>
      <header className={styles.header}>
        <span
          className={`${styles.symbol} ${needsAnswers ? 'i-ph:sliders-horizontal' : 'i-ph:blueprint'}`}
          aria-hidden="true"
        />
        <div className={styles.intro}>
          <h3>{needsAnswers ? '先对齐你的想法' : '这次准备这样做'}</h3>
          <p>{plan.goal}</p>
        </div>
        <span className={styles.state}>{needsAnswers ? '待选择' : '待确认'}</span>
      </header>

      {reviewing && needsAnswers ? (
        <div className={styles.questions}>
          {plan.questions.map((question) => (
            <fieldset key={question.id} disabled={!ready}>
              <legend>{question.title}</legend>
              <div className={styles.options}>
                {question.options.map((option) => (
                  <label key={option.id} className={styles.option} data-selected={answers[question.id] === option.id}>
                    <input
                      type="radio"
                      name={`plan-${question.id}`}
                      value={option.id}
                      checked={answers[question.id] === option.id}
                      onChange={() => setAnswers((previous) => ({ ...previous, [question.id]: option.id }))}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p className={styles.hint} aria-live="polite">
            已选择 {answered} / {plan.questions.length} 项，也可以点“调整需求”补充想法。
          </p>
        </div>
      ) : (
        <div className={styles.scope}>
          <h4>本次实现</h4>
          <ul>
            {plan.modules.slice(0, 3).map((item, index) => (
              <li key={index}>
                <span className="i-ph:check" aria-hidden="true" />
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.description}</p>
                </div>
              </li>
            ))}
          </ul>
          {plan.modules.length > 3 && (
            <p className={styles.hint}>另有 {plan.modules.length - 3} 个模块，可在方案详情中查看。</p>
          )}
          {!!plan.decisions?.length && (
            <p className={styles.hint}>已选：{plan.decisions.map((item) => item.answer).join('；')}</p>
          )}
        </div>
      )}

      <details className={styles.details}>
        <summary>
          <span className="i-ph:code" aria-hidden="true" />
          方案详情<span>技术、数据与验收</span>
        </summary>
        <div className={styles.detailBody}>
          <h4>技术与边界</h4>
          <p>{ENGINEERING_BOUNDARY.frontend}</p>
          <p>{ENGINEERING_BOUNDARY.backend}</p>
          <p>{ENGINEERING_BOUNDARY.unsupported}</p>
          <p>{plan.backendNotes}</p>
          <h4>完整模块</h4>
          <ul>
            {plan.modules.map((item, index) => (
              <li key={index}>
                <strong>{item.name}</strong>（{scopeLabel[item.scope]}）：{item.description}
              </li>
            ))}
          </ul>
          <h4>数据保存</h4>
          <p>{plan.dataStrategy}</p>
          <p>{ENGINEERING_BOUNDARY.data}</p>
          <h4>执行步骤</h4>
          <ol>
            {plan.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
          <h4>验收标准</h4>
          <ul>
            {plan.acceptance.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
          <h4>本期限制</h4>
          <ul>
            {plan.limitations.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
          <p>方案仅是待执行设计。刷新保留记录，不会自动批准或继续生成。选择后更新方案会计入模型额度。</p>
        </div>
      </details>

      {!plan.supported && (
        <p role="note" className={styles.notice}>
          当前范围不能直接执行：{plan.reason}
        </p>
      )}
      {reviewing && (
        <footer className={styles.footer}>
          {reviewError && (
            <p role="alert" className={styles.hint}>
              {reviewError}
            </p>
          )}
          {adjusting ? (
            <form
              className={styles.adjustment}
              onSubmit={(event) => {
                event.preventDefault();

                if (!ready || !feedback.trim() || feedback.trim().length > 2000) {
                  return;
                }

                try {
                  onAdjust(feedback.trim());
                  setAdjusting(false);
                  setAdjustmentError('');
                } catch (error) {
                  setAdjustmentError(error instanceof Error ? error.message : '方案暂时无法调整，请稍后重试。');
                }
              }}
            >
              <label>
                你想调整哪些地方？
                <textarea
                  ref={feedbackRef}
                  value={feedback}
                  maxLength={2000}
                  rows={3}
                  placeholder="例如：保留整体布局，把订阅表单改成预约演示，增加预算和联系方式。"
                  onChange={(event) => setFeedback(event.target.value)}
                  disabled={!ready}
                />
              </label>
              <p className={styles.hint}>原方案和已有预览保留。提交后只更新方案，再由你确认是否生成。</p>
              {adjustmentError && <p role="alert">{adjustmentError}</p>}
              <div className={styles.actions}>
                <button type="submit" className={styles.primary} disabled={!ready || !feedback.trim()}>
                  提交调整，更新方案
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    setAdjusting(false);
                    requestAnimationFrame(() => adjustButtonRef.current?.focus());
                  }}
                >
                  返回原方案
                </button>
              </div>
            </form>
          ) : (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                aria-label={needsAnswers ? '用这些选择更新方案' : '确认方案，开始生成'}
                disabled={!ready || !complete || (!needsAnswers && !plan.supported)}
                onClick={() => onConfirm(needsAnswers ? answers : undefined)}
              >
                {needsAnswers ? '更新方案' : '确认并生成'}
                <span className="i-ph:arrow-right" aria-hidden="true" />
              </button>
              <button
                ref={adjustButtonRef}
                type="button"
                className={styles.secondary}
                aria-label="调整需求"
                disabled={!ready}
                onClick={() => {
                  setAdjusting(true);
                  setAdjustmentError('');
                }}
              >
                调整需求
              </button>
            </div>
          )}
          <p className={styles.hint} role={!ready ? 'status' : undefined}>
            {!ready
              ? '正在保存方案，稍后即可确认。'
              : needsAnswers
                ? '先更新方案，再由你确认开始。'
                : '确认后开始生成，当前还没有修改文件。'}
          </p>
        </footer>
      )}
    </section>
  );
}
