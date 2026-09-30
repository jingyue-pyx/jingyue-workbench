import type { Message } from 'ai';
import { preparationFailureNotice, preparationFailureReason } from '~/lib/runtime/managed/failure-notice';
import styles from './PreparationFailureNotice.module.scss';

export function PreparationFailureNotice({ annotations }: Pick<Message, 'annotations'>) {
  return (
    <aside className={styles.notice} role="note" aria-label="页面准备提示">
      <p className={styles.title}>{preparationFailureNotice.title}</p>
      <p className={styles.reason}>
        <strong>未完成原因：</strong>
        {preparationFailureReason(annotations)}
      </p>
      <p className={styles.description}>{preparationFailureNotice.description}</p>
      <p className={styles.suggestions}>
        <span className={styles.label}>你可以这样说</span>
        {preparationFailureNotice.suggestions.map((suggestion) => (
          <span className={styles.example} key={suggestion}>
            “{suggestion}”
          </span>
        ))}
      </p>
    </aside>
  );
}
