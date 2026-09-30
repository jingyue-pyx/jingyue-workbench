import type { Message } from 'ai';
import { Fragment } from 'react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { useLocation } from '@remix-run/react';
import { db, chatId } from '~/lib/persistence/useChatHistory';
import { forkChat } from '~/lib/persistence/db';
import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import { profileStore } from '~/lib/stores/profile';
import { forwardRef } from 'react';
import type { ForwardedRef } from 'react';
import { isProjectId } from '~/lib/persistence/project-document';
import { runState } from '~/lib/runtime/managed/session';
import { ManagedRunStatus } from './ManagedRunStatus';
import { GenerationActivity } from './GenerationActivity';
import { runActivity } from '~/lib/runtime/managed/activity';
import { terminalPhase } from '~/lib/runtime/managed/protocol';
import styles from './Messages.module.scss';
import { isPreparationFailureNotice } from '~/lib/runtime/managed/failure-notice';
import { PreparationFailureNotice } from './PreparationFailureNotice';

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: Message[];
}

export const Messages = forwardRef<HTMLDivElement, MessagesProps>(
  (props: MessagesProps, ref: ForwardedRef<HTMLDivElement> | undefined) => {
    const { id, isStreaming = false, messages = [] } = props;
    const location = useLocation();
    const profile = useStore(profileStore);
    const activeId = useStore(chatId);
    const cloudProject = isProjectId(activeId);
    const managed = useStore(runState);
    const activity = useStore(runActivity);
    const activePlanMessage =
      managed.phase === 'reviewing'
        ? messages.filter((message) => message.id.startsWith(`${managed.id}-plan-`)).at(-1)?.id
        : undefined;

    const handleRewind = (messageId: string) => {
      const searchParams = new URLSearchParams(location.search);
      searchParams.set('rewindTo', messageId);
      window.location.search = searchParams.toString();
    };

    const handleFork = async (messageId: string) => {
      try {
        if (!db || !chatId.get()) {
          toast.error('Chat persistence is not available');
          return;
        }

        const urlId = await forkChat(db, chatId.get()!, messageId);
        window.location.href = `/chat/${urlId}`;
      } catch (error) {
        toast.error('Failed to fork chat: ' + (error as Error).message);
      }
    };

    return (
      <div id={id} className={props.className} ref={ref}>
        {cloudProject && (
          <p className="px-6 text-xs text-bolt-elements-textSecondary">
            云项目暂不支持按消息回退或分叉；可从侧栏复制完整项目（含已保存源码）。
          </p>
        )}
        {messages.length > 0
          ? messages.map((message, index) => {
              const { role, content, id: messageId, annotations } = message;
              const isUserMessage = role === 'user';
              const isFirst = index === 0;
              const isHidden = annotations?.includes('hidden');

              if (isHidden) {
                return <Fragment key={index} />;
              }

              return (
                <div
                  key={index}
                  className={classNames(styles.message, isUserMessage ? styles.user : styles.assistant, 'flex w-full', {
                    'mt-4': !isFirst,
                  })}
                >
                  {isUserMessage && (
                    <div
                      className={classNames(
                        styles.avatar,
                        'flex items-center justify-center overflow-hidden bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-500 rounded-full shrink-0 self-start',
                      )}
                    >
                      {profile?.avatar ? (
                        <img
                          src={profile.avatar}
                          alt={profile?.username || 'User'}
                          className="w-full h-full object-cover"
                          loading="eager"
                          decoding="sync"
                        />
                      ) : (
                        <div className="i-ph:user-fill text-2xl" />
                      )}
                    </div>
                  )}
                  <div className={classNames(styles.content, 'grid grid-col-1 w-full')}>
                    {messageId === activePlanMessage ? (
                      <ManagedRunStatus />
                    ) : annotations?.includes('managed-plan') ||
                      (role === 'assistant' &&
                        annotations?.includes('managed-run') &&
                        content.startsWith('### 自动任务结果')) ? (
                      <details className="rounded-xl border border-bolt-elements-borderColor px-4 py-3 text-sm">
                        <summary className="cursor-pointer font-medium text-bolt-elements-textPrimary">
                          {annotations?.includes('managed-plan') ? '方案记录' : '历史运行记录'}
                          <span className="ml-2 text-xs font-normal text-bolt-elements-textSecondary">查看详情</span>
                        </summary>
                        <p className="mt-2 text-xs text-bolt-elements-textSecondary">{content.split('\n\n')[1]}</p>
                        <AssistantMessage content={content} annotations={annotations} messageId={messageId} />
                      </details>
                    ) : isUserMessage ? (
                      <UserMessage content={content} />
                    ) : isPreparationFailureNotice(message) ? (
                      <PreparationFailureNotice annotations={message.annotations} />
                    ) : (
                      <AssistantMessage
                        content={content}
                        annotations={message.annotations}
                        messageId={messageId}
                        onRewind={cloudProject ? undefined : handleRewind}
                        onFork={cloudProject ? undefined : handleFork}
                      />
                    )}
                  </div>
                </div>
              );
            })
          : null}
        <GenerationActivity
          phase={managed.phase}
          activity={activity}
          checkingRuntime={managed.detail === '检查浏览器运行环境，尚未开始规划或写入源码'}
        />
        {isStreaming && terminalPhase(managed.phase) && (
          <div className="text-center w-full  text-bolt-elements-item-contentAccent i-svg-spinners:3-dots-fade text-4xl mt-4"></div>
        )}
      </div>
    );
  },
);
