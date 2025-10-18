import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  WebviewTag,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  PageTitleUpdatedEvent
} from 'electron';
import type { StreamCallbackMessage } from './types/agent';
import { mockAgentSSE } from './services/mockAgent';

interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
}

type ConversationEntry =
  | {
      id: string;
      role: 'user';
      text: string;
      timestamp: number;
    }
  | {
      id: string;
      role: 'agent';
      payload: StreamCallbackMessage;
      timestamp: number;
    };

const HOME_URL = 'https://www.bing.com';
const SEARCH_BASE = 'https://www.bing.com/search?q=';

const initialAgentMessage: StreamCallbackMessage = {
  taskId: 'welcome-task',
  agentName: 'AI Navigator',
  type: 'text',
  streamId: 'welcome-stream',
  streamDone: true,
  text: '准备就绪，随时向我询问关于当前页面的问题。'
};

const createMessageId = () =>
  (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2));

const normaliseUrl = (target: string): string => {
  if (!target) {
    return HOME_URL;
  }

  const trimmed = target.trim();

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    return url.toString();
  } catch (error) {
    // not a fully-qualified URL
  }

  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return `${SEARCH_BASE}${encodeURIComponent(trimmed)}`;
};

export default function App() {
  const webviewRef = useRef<WebviewTag | null>(null);
  const agentMessagesRef = useRef<HTMLDivElement | null>(null);

  const [address, setAddress] = useState<string>(HOME_URL);
  const [status, setStatus] = useState<string>('已加载');
  const [navState, setNavState] = useState({ canGoBack: false, canGoForward: false });
  const [conversation, setConversation] = useState<ConversationEntry[]>(() => [
    {
      id: 'welcome',
      role: 'agent',
      payload: initialAgentMessage,
      timestamp: Date.now()
    }
  ]);
  const [agentStatus, setAgentStatus] = useState('空闲');
  const [isAgentCollapsed, setAgentCollapsed] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [isStreaming, setStreaming] = useState(false);
  const streamCleanupRef = useRef<(() => void) | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);

  const updateNavigationState = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    setNavState({
      canGoBack: webview.canGoBack(),
      canGoForward: webview.canGoForward()
    });
  }, []);

  const loadUrl = useCallback((target: string) => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    const finalUrl = normaliseUrl(target);
    setAddress(finalUrl);
    webview.loadURL(finalUrl);
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    const handleDidStartLoading = () => setStatus('加载中…');
    const handleDidStopLoading = () => {
      setStatus('完成');
      updateNavigationState();
    };
    const handleDidFailLoad = () => setStatus('加载失败，请检查网络或网址');

    const handleDidNavigate = (event: DidNavigateEvent) => {
      if (event.url) {
        setAddress(event.url);
      }
      updateNavigationState();
    };

    const handleDidNavigateInPage = (event: DidNavigateInPageEvent) => {
      if (event.url) {
        setAddress(event.url);
      }
      updateNavigationState();
    };

    const handlePageTitleUpdated = (event: PageTitleUpdatedEvent) => {
      document.title = `${event.title} — AI Native Browser Shell`;
    };

    const handleDomReady = () => {
      updateNavigationState();
      webview.focus();
    };

    webview.addEventListener('did-start-loading', handleDidStartLoading);
    webview.addEventListener('did-stop-loading', handleDidStopLoading);
    webview.addEventListener('did-fail-load', handleDidFailLoad);
    webview.addEventListener('did-navigate', handleDidNavigate as EventListener);
    webview.addEventListener('did-navigate-in-page', handleDidNavigateInPage as EventListener);
    webview.addEventListener('page-title-updated', handlePageTitleUpdated as EventListener);
    webview.addEventListener('dom-ready', handleDomReady);

    return () => {
      webview.removeEventListener('did-start-loading', handleDidStartLoading);
      webview.removeEventListener('did-stop-loading', handleDidStopLoading);
      webview.removeEventListener('did-fail-load', handleDidFailLoad);
      webview.removeEventListener('did-navigate', handleDidNavigate as EventListener);
      webview.removeEventListener('did-navigate-in-page', handleDidNavigateInPage as EventListener);
      webview.removeEventListener('page-title-updated', handlePageTitleUpdated as EventListener);
      webview.removeEventListener('dom-ready', handleDomReady);
    };
  }, [updateNavigationState]);

  useEffect(() => {
    const nativeAPI = window.nativeAPI;
    if (!nativeAPI?.onOpenUrlInTab) {
      return;
    }

    nativeAPI.onOpenUrlInTab((url: string) => {
      loadUrl(url);
      nativeAPI.focusWindow?.();
    });
  }, [loadUrl]);

  useEffect(() => {
    const nativeAPI = window.nativeAPI;
    if (!nativeAPI?.getAppInfo) {
      return;
    }

    nativeAPI.getAppInfo().then((info: AppInfo | undefined) => {
      if (info) {
        setAppInfo(info);
      }
    });
  }, []);

  useEffect(() => {
    if (!agentMessagesRef.current) {
      return;
    }

    agentMessagesRef.current.scrollTo({
      top: agentMessagesRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [conversation]);

  useEffect(() => {
    return () => {
      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
      }
    };
  }, []);

  const handleAddressSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      loadUrl(address);
    },
    [address, loadUrl]
  );

  const handleAgentSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const message = String(formData.get('message') ?? '').trim();

      if (!message) {
        return;
      }

      const userEntry: ConversationEntry = {
        id: createMessageId(),
        role: 'user',
        text: message,
        timestamp: Date.now()
      };
      setConversation((prev) => [...prev, userEntry]);

      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
      }

      form.reset();
      const taskId = createMessageId();
      setCurrentTaskId(taskId);
      setStreaming(true);
      setAgentStatus('Agent 正在处理…');

      const cleanup = mockAgentSSE({
        prompt: message,
        currentUrl: address || HOME_URL,
        taskId,
        agentName: 'AI Navigator',
        onMessage: (payload) => {
          setConversation((prev) => [
            ...prev,
            {
              id: createMessageId(),
              role: 'agent',
              payload,
              timestamp: Date.now()
            }
          ]);

          switch (payload.type) {
            case 'thinking':
              setAgentStatus('Agent 正在思考…');
              break;
            case 'text':
              setAgentStatus(payload.streamDone ? 'Agent 完成回复' : 'Agent 正在回答…');
              if (payload.streamDone) {
                setStreaming(false);
              }
              break;
            case 'tool_running':
              setAgentStatus(`调用工具：${payload.toolName}`);
              break;
            case 'tool_result':
              setAgentStatus(`工具 ${payload.toolName} 返回结果`);
              break;
            case 'error':
              setAgentStatus('Agent 出错');
              setStreaming(false);
              break;
            case 'finish':
              setAgentStatus('空闲');
              setStreaming(false);
              streamCleanupRef.current = null;
              break;
            default:
              break;
          }
        },
        onComplete: () => {
          setStreaming(false);
          setAgentStatus('空闲');
          streamCleanupRef.current = null;
        },
        onError: () => {
          setStreaming(false);
          setAgentStatus('Agent 出错');
          streamCleanupRef.current = null;
        }
      });

      streamCleanupRef.current = cleanup;
    },
    [address]
  );

  const handleNewWindow = useCallback(() => {
    const nativeAPI = window.nativeAPI;
    nativeAPI?.createNewWindow?.(address || HOME_URL);
  }, [address]);

  const handleToggleDevtools = useCallback(() => {
    window.nativeAPI?.toggleDevtools?.();
  }, []);

  const appInfoText = useMemo(() => {
    if (!appInfo) {
      return '';
    }

    return `App ${appInfo.version} · Electron ${appInfo.electron} · Chromium ${appInfo.chrome}`;
  }, [appInfo]);

  const toolbarButtonClass =
    'rounded-md bg-white/10 px-2.5 py-1.5 text-sm text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40';

  const actionButtonClass = 'rounded-md bg-white/10 px-3 py-1.5 text-sm text-white transition hover:bg-white/20';

  const agentPanelBaseClasses =
    'flex h-full w-[340px] min-w-[280px] flex-col border-l border-white/10 bg-[rgba(17,18,30,0.95)] backdrop-blur-xl transition-all duration-200 ease-in-out';

  const agentPanelClasses = isAgentCollapsed
    ? `${agentPanelBaseClasses} w-16 min-w-0`
    : agentPanelBaseClasses;

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex items-center gap-3 border-b border-white/10 bg-gradient-to-r from-[#1a1c2c] to-[#13141f] px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            title="后退"
            onClick={() => webviewRef.current?.goBack()}
            disabled={!navState.canGoBack}
            className={toolbarButtonClass}
          >
            ⟨
          </button>
          <button
            type="button"
            title="前进"
            onClick={() => webviewRef.current?.goForward()}
            disabled={!navState.canGoForward}
            className={toolbarButtonClass}
          >
            ⟩
          </button>
          <button type="button" title="刷新" onClick={() => webviewRef.current?.reload()} className={toolbarButtonClass}>
            ⟳
          </button>
          <button type="button" title="首页" onClick={() => loadUrl(HOME_URL)} className={toolbarButtonClass}>
            ⌂
          </button>
        </div>

        <form className="flex-1" autoComplete="off" onSubmit={handleAddressSubmit}>
          <input
            type="text"
            name="address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="输入网址或搜索内容"
            spellCheck={false}
            className="w-full rounded-lg border border-white/10 bg-[#181b2d]/95 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:border-blue-400/80 focus:outline-none focus:ring-2 focus:ring-blue-400/60"
          />
        </form>

        <div className="flex items-center gap-2">
          <button type="button" title="新建窗口" onClick={handleNewWindow} className={actionButtonClass}>
            🗗
          </button>
          <button type="button" title="开发者工具" onClick={handleToggleDevtools} className={actionButtonClass}>
            {'{ }'}
          </button>
        </div>
      </header>

      <main className="flex flex-1 min-h-0 bg-transparent">
        <section className="flex-1 min-w-0 p-3 pr-0">
          <webview
            ref={webviewRef}
            className="h-full w-full rounded-lg border border-white/5 bg-black/40"
            src={HOME_URL}
            allowpopups
            disableblinkfeatures="AutomationControlled"
          />
        </section>

        <aside className={agentPanelClasses} aria-label="AI 交互区">
          <header
            className={`flex w-full items-center gap-3 border-b border-white/10 px-4 py-3 ${
              isAgentCollapsed ? 'justify-center' : 'justify-between'
            }`}
          >
            {!isAgentCollapsed && (
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-white">AI Agent</span>
                <span className="text-xs text-white/60">随时咨询你的智能助手</span>
              </div>
            )}
            <button
              type="button"
              id="collapse-agent"
              title="折叠面板"
              className="rounded-md bg-white/10 p-2 text-white transition hover:bg-white/20"
              onClick={() => setAgentCollapsed((prev) => !prev)}
            >
              {isAgentCollapsed ? '⟫' : '⟪'}
            </button>
          </header>

          {!isAgentCollapsed && (
            <>
              <section
                ref={agentMessagesRef}
                className="flex-1 overflow-y-auto space-y-3 px-4 py-4"
                aria-live="polite"
              >
                {conversation.map((entry) => {
                  if (entry.role === 'user') {
                    return (
                      <div key={entry.id} className="flex flex-col gap-1 text-sm leading-relaxed">
                        <span className="text-xs font-medium text-white/60">你</span>
                        <p className="ml-auto w-fit max-w-full rounded-lg bg-gradient-to-r from-[#2a7ae2] to-[#3664f4] px-3 py-2 text-white">
                          {entry.text}
                        </p>
                      </div>
                    );
                  }

                  const payload = entry.payload;

                  switch (payload.type) {
                    case 'thinking':
                      return (
                        <div key={entry.id} className="flex flex-col gap-1 text-sm leading-relaxed text-white/80">
                          <span className="text-xs font-medium text-white/60">Agent 正在思考…</span>
                          <p className="w-fit max-w-full rounded-lg bg-white/5 px-3 py-2 italic text-white/80">
                            {payload.text}
                          </p>
                        </div>
                      );
                    case 'text':
                      return (
                        <div key={entry.id} className="flex flex-col gap-1 text-sm leading-relaxed">
                          <span className="text-xs font-medium text-white/60">
                            Agent {payload.streamDone ? '回复完成' : '正在回复…'}
                          </span>
                          <p className="w-fit max-w-full rounded-lg bg-white/10 px-3 py-2 text-white">
                            {payload.text}
                          </p>
                        </div>
                      );
                    case 'tool_streaming':
                      return (
                        <div key={entry.id} className="flex flex-col gap-1 text-sm leading-relaxed">
                          <span className="text-xs font-medium text-amber-300/90">
                            调用工具 {payload.toolName}
                          </span>
                          <pre className="w-full max-w-full overflow-auto rounded-lg bg-black/40 px-3 py-2 text-xs text-amber-100/90">
                            {payload.paramsText}
                          </pre>
                        </div>
                      );
                    case 'tool_running':
                      return (
                        <div key={entry.id} className="flex flex-col gap-1 text-sm leading-relaxed text-sky-200/90">
                          <span className="text-xs font-medium text-sky-300/90">
                            工具 {payload.toolName} 正在执行…
                          </span>
                          <p className="w-fit max-w-full rounded-lg bg-sky-500/20 px-3 py-2 text-sky-100">
                            {payload.text}
                          </p>
                        </div>
                      );
                    case 'tool_use':
                      return (
                        <div key={entry.id} className="flex flex-col gap-1 text-sm leading-relaxed text-indigo-100/90">
                          <span className="text-xs font-medium text-indigo-300/90">
                            调用工具 {payload.toolName} 参数
                          </span>
                          <pre className="w-full max-w-full overflow-auto rounded-lg bg-indigo-500/20 px-3 py-2 text-xs text-indigo-100">
                            {JSON.stringify(payload.params, null, 2)}
                          </pre>
                        </div>
                      );
                    case 'tool_result':
                      return (
                        <div key={entry.id} className="flex flex-col gap-1 text-sm leading-relaxed text-emerald-100/90">
                          <span className="text-xs font-medium text-emerald-300/90">
                            工具 {payload.toolName} 返回结果
                          </span>
                          <pre className="w-full max-w-full overflow-auto rounded-lg bg-emerald-500/20 px-3 py-2 text-xs text-emerald-100">
                            {JSON.stringify(payload.toolResult, null, 2)}
                          </pre>
                        </div>
                      );
                    case 'workflow':
                      return (
                        <div key={entry.id} className="flex flex-col gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-white/80">
                          <div className="text-xs font-medium text-white/60">工作流：{payload.workflow.name}</div>
                          {payload.workflow.steps?.map((step) => (
                            <div key={step.id} className="flex items-start gap-2 text-xs text-white/70">
                              <span className="mt-1 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px]">
                                {step.title[0]?.toUpperCase() ?? '•'}
                              </span>
                              <div>
                                <div className="font-semibold text-white/80">{step.title}</div>
                                {step.description && <div className="text-white/60">{step.description}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    case 'agent_start':
                      return (
                        <div key={entry.id} className="flex flex-col gap-1 text-sm leading-relaxed text-white/70">
                          <span className="text-xs font-medium text-white/50">Agent 启动</span>
                          <div className="rounded-lg bg-white/5 px-3 py-2">
                            <div className="text-sm text-white/80">{payload.agentNode.name}</div>
                            {payload.agentNode.description && (
                              <div className="text-xs text-white/60">{payload.agentNode.description}</div>
                            )}
                          </div>
                        </div>
                      );
                    case 'agent_result':
                      return (
                        <div key={entry.id} className="flex flex-col gap-1 text-sm leading-relaxed text-emerald-100/90">
                          <span className="text-xs font-medium text-emerald-200/90">Agent 结果</span>
                          <p className="w-fit max-w-full rounded-lg bg-emerald-500/20 px-3 py-2 text-emerald-100">
                            {payload.result ?? 'Agent 完成'}
                          </p>
                        </div>
                      );
                    case 'error':
                      return (
                        <div key={entry.id} className="flex flex-col gap-1 text-sm leading-relaxed text-rose-100/90">
                          <span className="text-xs font-medium text-rose-300/90">Agent 出错</span>
                          <pre className="w-full max-w-full overflow-auto rounded-lg bg-rose-500/20 px-3 py-2 text-xs text-rose-100">
                            {JSON.stringify(payload.error, null, 2)}
                          </pre>
                        </div>
                      );
                    case 'finish':
                      return (
                        <div key={entry.id} className="flex flex-col gap-1 text-xs leading-relaxed text-white/50">
                          <span className="font-medium text-white/60">会话结束</span>
                          <span>原因：{payload.finishReason}</span>
                          <span>
                            Token 用量：prompt {payload.usage.promptTokens} · completion {payload.usage.completionTokens} · total
                            {payload.usage.totalTokens}
                          </span>
                        </div>
                      );
                    default:
                      return null;
                  }
                })}
              </section>

              <form
                className="flex flex-col gap-2 border-t border-white/10 bg-[rgba(12,13,25,0.9)] px-4 py-4"
                autoComplete="off"
                onSubmit={handleAgentSubmit}
              >
                <label className="text-xs text-white/60" htmlFor="agent-input">
                  输入消息
                </label>
                <textarea
                  id="agent-input"
                  name="message"
                  rows={3}
                  placeholder="我能帮你做什么？"
                  required
                  className="w-full resize-y rounded-lg border border-white/10 bg-[#191b2d]/95 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:border-blue-400/80 focus:outline-none focus:ring-2 focus:ring-blue-400/60"
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-white/60">{agentStatus}</span>
                  <button
                    type="submit"
                    disabled={isStreaming}
                    className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#4a7afe] to-[#6e61ff] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isStreaming && (
                      <span className="inline-flex h-3 w-3 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
                    )}
                    {isStreaming ? '生成中…' : '发送'}
                  </button>
                </div>
              </form>
            </>
          )}
        </aside>
      </main>

      {/* <footer className="flex items-center justify-between border-t border-white/10 bg-[rgba(18,20,33,0.95)] px-3 py-1 text-xs text-white/70">
        <span>{status}</span>
        <span>{appInfoText}</span>
      </footer> */}
    </div>
  );
}
