import type { Message } from 'ai';
import { Markdown } from './Markdown';
import { PreparationFailureNotice } from './PreparationFailureNotice';
import { isPreparationFailureNotice } from '~/lib/runtime/managed/failure-notice';
import styles from './ProjectLoadingView.module.scss';
import messageStyles from './Messages.module.scss';

/** Display only: no action parser, approval controls, editor or autosave. */
export function ProjectLoadingView({
  messages,
  cached = false,
  error,
  onRetry,
}: {
  messages?: Message[];
  cached?: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const conversationReady = messages !== undefined;
  const title =
    cached && conversationReady
      ? '已显示本机历史，正在同步最新内容…'
      : conversationReady
        ? error
          ? '会话已恢复，代码暂未加载'
          : '会话已恢复，正在加载代码…'
        : error
          ? '会话暂未恢复'
          : '正在恢复会话…';

  return (
    <div className={styles.layout} data-conversation-ready={conversationReady}>
      <section className={styles.conversation} aria-label="会话恢复">
        <div className={styles.status} role={error ? 'alert' : 'status'}>
          <h2>{title}</h2>
          <p>
            {cached && conversationReady
              ? '可以先查看上次保存的对话。最新内容确认后，再恢复代码与预览。'
              : conversationReady
                ? '你可以先查看历史对话。代码恢复后将继续启动预览，无需重新生成。'
                : '先加载历史对话，再恢复代码与预览。'}
          </p>
          {error && (
            <>
              <p>{error}</p>
              <button onClick={onRetry}>重新加载</button> <a href="/">返回首页</a>
            </>
          )}
        </div>
        <div className={styles.history} aria-label="历史对话">
          {messages
            ?.filter((message) => !message.annotations?.includes('hidden'))
            .map((message) => (
              <article
                key={message.id}
                className={`${messageStyles.message} ${message.role === 'user' ? messageStyles.user : messageStyles.assistant}`}
              >
                <span className={styles.speaker}>{message.role === 'user' ? '你' : 'AI'}</span>
                {isPreparationFailureNotice(message) ? (
                  <PreparationFailureNotice annotations={message.annotations} />
                ) : (
                  <Markdown>
                    {message.role === 'assistant'
                      ? message.content.replace(
                          /<boltArtifact\b[\s\S]*?(?:<\/boltArtifact>|$)/g,
                          '\n\n（源码文件将在右侧恢复）\n\n',
                        )
                      : message.content}
                  </Markdown>
                )}
              </article>
            ))}
        </div>
        {conversationReady && <p className={styles.readOnly}>代码加载期间可查看对话；完成后即可继续提问和修改。</p>}
      </section>
      {conversationReady && (
        <section className={styles.code} aria-label="代码与预览恢复">
          <span className={styles.codeTitle}>代码与预览</span>
          <div className={styles.placeholder}>
            <span className="i-ph:code text-2xl" aria-hidden="true" />
            <p>
              {error ? '代码加载暂未完成' : cached ? '正在同步项目，随后恢复代码与预览…' : '正在恢复源码与运行环境…'}
            </p>
            <span>历史对话已在左侧显示，已保存的源码保留。</span>
          </div>
        </section>
      )}
    </div>
  );
}
