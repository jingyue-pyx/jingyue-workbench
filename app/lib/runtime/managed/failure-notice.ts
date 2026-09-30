import type { Message } from 'ai';
import { parseOutcomeAnnotation } from './outcome';

export const LEGACY_PREPARATION_FAILURE = '这次未能完成页面准备，当前草稿保留。可以重试或调整需求。';

export const preparationFailureNotice = {
  title: '这一步还没完成，当前草稿已保留',
  description: '你可以在下方继续提问，或补充想调整的内容，不必重新描述整个项目。',
  suggestions: ['为什么没有完成？', '重试上次任务', '我想调整……'],
};

/*
 * Plain text remains useful in exports and model history. Typography belongs
 * to the view; no HTML or executable action is stored in the conversation.
 */
export const PREPARATION_FAILURE_MESSAGE = `${preparationFailureNotice.title}。\n\n${preparationFailureNotice.description}\n\n例如：“${preparationFailureNotice.suggestions.join('”、“')}”。`;

export function preparationFailureReason(annotations?: Message['annotations']) {
  /*
   * Read only this message's result. A later run must not rewrite why an older
   * message failed, and missing historical diagnostics must not be guessed.
   */
  const result = annotations?.map(parseOutcomeAnnotation).find((outcome) => outcome?.outcome === 'failed');

  if (!result) {
    return '暂未定位具体原因，这条记录没有保留明确的失败阶段和原因。';
  }

  if (result.reasonCode === 'other' || result.reasonCode === 'none') {
    return `停在${result.stage}，暂未定位具体原因。`;
  }

  return `${result.stage}阶段：${result.reason}。`;
}

export function isPreparationFailureNotice(message: Pick<Message, 'role' | 'content' | 'annotations'>) {
  if (message.role !== 'assistant' || !message.annotations?.includes('managed-run')) {
    return false;
  }

  const outcome = message.annotations.find(
    (annotation) => typeof annotation === 'string' && annotation.startsWith('managed-outcome:'),
  );

  if (typeof outcome === 'string' && !outcome.startsWith('managed-outcome:failed:')) {
    return false;
  }

  /*
   * Also upgrade old system messages at render time, without rewriting saved
   * history or changing normal answers / quoted copies of the error message.
   */
  return [LEGACY_PREPARATION_FAILURE, PREPARATION_FAILURE_MESSAGE].includes(message.content.trim());
}
