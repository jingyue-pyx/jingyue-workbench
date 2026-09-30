/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts } from '~/lib/hooks';
import { description, useChatHistory } from '~/lib/persistence';
import { chatId } from '~/lib/persistence/useChatHistory';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import Cookies from '~/lib/auth/account-cookies';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
import { createSampler } from '~/utils/sampler';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { supabaseConnection } from '~/lib/stores/supabase';
import { ProjectSyncStatus } from './ProjectSyncStatus';
import {
  captureSources,
  runManagedTask,
  runState,
  stopManagedRun,
  verifyRestoredProject,
} from '~/lib/runtime/managed/session';
import { terminalPhase } from '~/lib/runtime/managed/protocol';
import { routeConversation, latestOutcome } from '~/lib/runtime/managed/conversation';
import { managedModelRequest } from '~/lib/runtime/managed/model-client';
import { ProjectLoadingView } from './ProjectLoadingView';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, loadError, conversationMessages, initialMessages, storeMessageHistory, importChat, exportChat } =
    useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  return (
    <>
      <ProjectSyncStatus />
      {!ready && (
        <ProjectLoadingView
          messages={conversationMessages}
          error={loadError}
          onRetry={() => window.location.reload()}
        />
      )}
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
        />
      )}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          /**
           * @todo Handle more types if we need them. This may require extra color palettes.
           */
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
        autoClose={3000}
      />
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    // Imports also need their first settled filesystem snapshot, even without a new model reply.
    if (!isLoading && messages.length > 0 && messages.length >= initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  },
  50,
);

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
}

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading] = useState(false);
    const files = useStore(workbenchStore.files);
    const actionAlert = useStore(workbenchStore.alert);
    const managedState = useStore(runState);
    const managedBusy = !terminalPhase(managedState.phase);
    const [routing, setRouting] = useState(false);
    const conversationAbort = useRef<AbortController>();
    const taskPromise = useRef<Promise<unknown>>();
    const messagesRef = useRef(initialMessages);
    useEffect(() => {
      let active = true;

      if (initialMessages.some((message) => message.annotations?.includes('managed-restore'))) {
        verifyRestoredProject(async (result) => {
          if (!active) {
            return;
          }

          messagesRef.current = [...messagesRef.current, result];
          setMessages(messagesRef.current);
          await storeMessageHistory(messagesRef.current);
        }).catch((error) => {
          if (active) {
            toast.error(error.message);
          }
        });
      }

      return () => {
        active = false;
        conversationAbort.current?.abort();
        stopManagedRun('页面已切换，自动任务已停止。');
      };
    }, []);

    const deployAlert = useStore(workbenchStore.deployAlert);
    const supabaseConn = useStore(supabaseConnection); // Add this line to get Supabase connection
    const selectedProject = supabaseConn.stats?.projects?.find(
      (project) => project.id === supabaseConn.selectedProjectId,
    );
    const supabaseAlert = useStore(workbenchStore.supabaseAlert);
    const { activeProviders, promptId, contextOptimizationEnabled } = useSettings();

    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });

    const { showChat } = useStore(chatStore);

    const [animationScope, animate] = useAnimate();

    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      setMessages,
      error,
      data: chatData,
      setData,
    } = useChat({
      api: '/api/chat',
      body: {
        apiKeys,
        files,
        promptId,
        contextOptimization: contextOptimizationEnabled,
        supabase: {
          isConnected: supabaseConn.isConnected,
          hasSelectedProject: !!selectedProject,
          credentials: {
            supabaseUrl: supabaseConn?.credentials?.supabaseUrl,
            anonKey: supabaseConn?.credentials?.anonKey,
          },
        },
      },
      sendExtraMessageFields: true,
      onError: (e) => {
        logger.error('Request failed\n\n', e, error);
        logStore.logError('Chat request failed', e, {
          component: 'Chat',
          action: 'request',
          error: e.message,
        });
        toast.error(
          'There was an error processing your request: ' + (e.message ? e.message : 'No details were returned'),
        );
      },
      onFinish: (message, response) => {
        const usage = response.usage;
        setData(undefined);

        if (usage) {
          console.log('Token usage:', usage);
          logStore.logProvider('Chat response completed', {
            component: 'Chat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });
    useEffect(() => {
      const prompt = searchParams.get('prompt');

      // console.log(prompt, searchParams, model, provider);

      if (prompt) {
        setSearchParams({});
        void sendMessage({} as React.UIEvent, prompt);
      }
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    useEffect(() => {
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      conversationAbort.current?.abort();
      stopManagedRun();
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);

      chatStore.setKey('started', true);

      setChatStarted(true);
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      if (isLoading || conversationAbort.current || (managedBusy && managedState.phase !== 'reviewing')) {
        abort();
        return;
      }

      /*
       * The managed pipeline owns file application and verification. It does not
       * turn model output into executable chat artifacts or arbitrary shell commands.
       */
      if (uploadedFiles.length || imageDataList.length) {
        toast.info('当前自动闭环先支持文本需求；请移除附件后运行。');
        return;
      }

      runAnimation();

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: messageContent,
        annotations: ['managed-run'],
      };
      messagesRef.current = [...messages, userMessage];
      setMessages(messagesRef.current);
      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);
      chatStore.setKey('aborted', false);

      const requestAbort = new AbortController();
      const routingTimeout = setTimeout(
        () => requestAbort.abort(new Error('对话响应超时，尚未开始新的生成任务。')),
        60000,
      );
      conversationAbort.current = requestAbort;
      setRouting(true);

      const record = async (result: Message) => {
        messagesRef.current = [...messagesRef.current, result];
        setMessages(messagesRef.current);
        await storeMessageHistory(messagesRef.current);
      };

      try {
        // Persist first so a new task has a stable, account-scoped project id.
        await storeMessageHistory(messagesRef.current);

        /*
         * Questions need the same current project snapshot as coding tasks.
         * Do not read a different cloud project or wait for a sandbox reinstall.
         */
        const sources = captureSources();
        const decision = await routeConversation(messageContent, {
          history: messagesRef.current,
          hasSources: Object.keys(sources).length > 0,
          signal: requestAbort.signal,
          request: (phase, task) =>
            managedModelRequest(
              phase,
              {
                task,
                files: sources,
                errors: [JSON.stringify(latestOutcome(messagesRef.current) || {})],
              },
              {
                model,
                provider: provider.name,
                history: messagesRef.current,
                signal: requestAbort.signal,
                projectId: chatId.get(),
              },
            ),
        });
        requestAbort.signal.throwIfAborted();

        if ('answer' in decision) {
          await record({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: decision.answer,
            annotations: ['managed-run', 'managed-answer'],
          });
          return;
        }

        if ('action' in decision) {
          if (!terminalPhase(runState.get().phase)) {
            await record({
              id: crypto.randomUUID(),
              role: 'assistant',
              annotations: ['managed-run', 'managed-answer'],
              content: '当前方案仍待确认，请先确认或调整这份方案；本次没有重新规划或改动文件。',
            });
            return;
          }

          if (!Object.keys(workbenchStore.files.get()).some((path) => path.endsWith('/package.json'))) {
            await record({
              id: crypto.randomUUID(),
              role: 'assistant',
              annotations: ['managed-run', 'managed-answer'],
              content: '当前项目还没有可运行的源码。先完成已有方案的生成，再启动预览；本次不会自动创建新方案。',
            });
            return;
          }

          conversationAbort.current = undefined;
          clearTimeout(routingTimeout);
          setRouting(false);
          await record({
            id: crypto.randomUUID(),
            role: 'assistant',
            annotations: ['managed-run'],
            content: '正在使用已有源码重新检查并启动预览，不重新规划、不调用模型改写文件。',
          });
          taskPromise.current = verifyRestoredProject(record);
          await taskPromise.current;

          return;
        }

        /*
         * Asking a question leaves the pending plan alone. A new explicit task
         * invalidates the old approval before starting another plan.
         */
        if (runState.get().phase === 'reviewing') {
          stopManagedRun('新的需求替代了待确认方案；旧确认按钮已失效。');
          await taskPromise.current;
        }

        requestAbort.signal.throwIfAborted();
        messagesRef.current = messagesRef.current.map((message) =>
          message.id === userMessage.id
            ? { ...message, content: decision.task, annotations: ['managed-run', 'managed-task'] }
            : message,
        );
        setMessages(messagesRef.current);
        await storeMessageHistory(messagesRef.current);
        conversationAbort.current = undefined;
        clearTimeout(routingTimeout);
        setRouting(false);
        taskPromise.current = runManagedTask(decision.task, {
          model,
          provider: provider.name,
          reviewPlan: decision.reviewPlan,
          history: messagesRef.current,
          saveDraft: () => storeMessageHistory(messagesRef.current),
          record,
        });
        await taskPromise.current;
      } catch (error) {
        if (
          requestAbort.signal.aborted &&
          requestAbort.signal.reason instanceof Error &&
          requestAbort.signal.reason.message.includes('响应超时')
        ) {
          toast.error(requestAbort.signal.reason.message);
        } else if (!requestAbort.signal.aborted) {
          toast.error(error instanceof Error ? error.message : '自动任务未启动，草稿保留。');
        }
      } finally {
        clearTimeout(routingTimeout);

        // A previous long-running plan must not clear a newer question's state.
        if (conversationAbort.current === requestAbort) {
          conversationAbort.current = undefined;
          setRouting(false);
        }
      }

      return;
    };

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    return (
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading || fakeLoading || routing || (managedBusy && managedState.phase !== 'reviewing')}
        onStreamingChange={(streaming) => {
          streamingState.set(streaming);
        }}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={activeProviders}
        handleInputChange={(e) => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={abort}
        description={description}
        importChat={importChat}
        exportChat={exportChat}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            (input) => {
              setInput(input);
              scrollTextArea();
            },
            model,
            provider,
            apiKeys,
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        supabaseAlert={supabaseAlert}
        clearSupabaseAlert={() => workbenchStore.clearSupabaseAlert()}
        deployAlert={deployAlert}
        clearDeployAlert={() => workbenchStore.clearDeployAlert()}
        data={chatData}
      />
    );
  },
);
