import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { currentAccount } from '~/lib/auth/account-context';
import chrome from '~/components/ui/WorkbenchChrome.module.scss';
import { JingyueBrand } from '~/components/ui/JingyueBrand';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header
      className={classNames(chrome.header, 'flex items-center p-5 border-b h-[var(--header-height)]', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
      })}
    >
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer">
        <div className="i-ph:sidebar-simple-duotone text-xl" />
        <JingyueBrand />
      </div>
      {chat.started && ( // Display ChatDescription and HeaderActionButtons only when the chat has started.
        <>
          <span className={classNames(chrome.title, 'flex-1 px-2 truncate text-center text-bolt-elements-textPrimary')}>
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </span>
          <ClientOnly>
            {() => (
              <div className="mr-1 shrink-0">
                <HeaderActionButtons />
              </div>
            )}
          </ClientOnly>
        </>
      )}
      <ClientOnly>
        {() =>
          currentAccount && (
            <a
              href="/account"
              className={classNames(
                chrome.account,
                'ml-auto px-3 py-2 rounded-lg border border-bolt-elements-borderColor text-sm text-bolt-elements-textPrimary',
              )}
              title="修改显示名或退出登录"
            >
              {currentAccount.displayName} · 账号
            </a>
          )
        }
      </ClientOnly>
    </header>
  );
}
