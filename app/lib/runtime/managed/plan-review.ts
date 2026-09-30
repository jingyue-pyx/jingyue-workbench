import { RunError, type PlanAnswers } from './protocol';

export type PlanReviewDecision = { kind: 'confirm'; answers?: PlanAnswers } | { kind: 'adjust'; feedback: string };

export function validatePlanAdjustment(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000) {
    throw new RunError('请填写 1–2000 字的方案调整要求。');
  }

  return value.trim();
}

/** An approval belongs to one live run; it is never restored from storage. */
export class PlanReviewGate {
  #pending?: { id: string; resolve: (decision: PlanReviewDecision) => void };

  wait(id: string, signal: AbortSignal): Promise<PlanReviewDecision> {
    signal.throwIfAborted();

    if (this.#pending) {
      throw new RunError('已有方案等待确认。');
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.#pending = undefined;
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        reject(signal.reason || new RunError('已取消方案，未开始生成。'));
      };
      this.#pending = {
        id,
        resolve: (decision) => {
          cleanup();
          resolve(decision);
        },
      };
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  confirm(id: string, answers?: PlanAnswers) {
    if (!this.#pending || this.#pending.id !== id) {
      return false;
    }

    this.#pending.resolve({ kind: 'confirm', answers });

    return true;
  }

  adjust(id: string, feedback: string) {
    const validated = validatePlanAdjustment(feedback);

    if (!this.#pending || this.#pending.id !== id) {
      return false;
    }

    this.#pending.resolve({ kind: 'adjust', feedback: validated });

    return true;
  }
}
