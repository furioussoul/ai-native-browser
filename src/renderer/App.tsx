import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { WebviewTag, DidNavigateEvent, DidNavigateInPageEvent, PageTitleUpdatedEvent } from "electron";
import type { StreamCallbackMessage } from "./types/agent";
import type { StreamCallbackMessage as EkoStreamMessage } from "@eko-ai/eko";
// 使用真实 Agent，而不是本地 mock 流
import realAgentRun from "./services/Agent";

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
          role: "user";
          text: string;
          timestamp: number;
      }
    | {
          id: string;
          role: "agent";
          payload: StreamCallbackMessage;
          timestamp: number;
      };

const HOME_URL = "https://www.bing.com";
const SEARCH_BASE = "https://www.bing.com/search?q=";

const initialAgentMessage: StreamCallbackMessage = {
    taskId: "welcome-task",
    agentName: "AI Navigator",
    type: "text",
    streamId: "welcome-stream",
    streamDone: true,
    text: "准备就绪，随时向我询问关于当前页面的问题。",
};

const createMessageId = () =>
    globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2);

const normaliseUrl = (target: string): string => {
    if (!target) return HOME_URL;
    const trimmed = target.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    try {
        return new URL(trimmed).toString();
    } catch {}
    if (/^[\w-]+(\.[\w-]+)+(\:\d+)?(\/.*)?$/.test(trimmed)) return `https://${trimmed}`;
    return `${SEARCH_BASE}${encodeURIComponent(trimmed)}`;
};
// 组件主体开始
export default function App() {
    // 多 Tab：使用字典存储 webview 引用
    const webviewRefs = useRef<Record<number, WebviewTag | null>>({});
    const nextTabIdRef = useRef<number>(1);
    const [tabs, setTabs] = useState<Array<{ tabId: number; url: string; title: string; loading: boolean }>>(() => [
        { tabId: 0, url: HOME_URL, title: "首页", loading: false },
    ]);
    const [activeTabId, setActiveTabId] = useState<number>(0);
    // Tab URL 编辑状态：tabId -> 正在编辑的临时值
    const [editingTabId, setEditingTabId] = useState<number | null>(null);
    const [editingValue, setEditingValue] = useState<string>("");
    // 同步全局供 Agent 获取
    useEffect(() => {
        window.__tabs = tabs.map((t) => ({ tabId: t.tabId, url: t.url, title: t.title }));
        window.__activeTabId = activeTabId;
        const active = tabs.find((t) => t.tabId === activeTabId);
        if (active) window.__activeTabUrl = active.url;
        // 提供快照函数：到激活 webview 内部执行脚本收集真实页面内容
        window.__getActivePageSnapshot = async () => {
            const wv = webviewRefs.current[activeTabId];
            if (!wv) return null;
            try {
                const result = await wv.executeJavaScript(
                    `(() => {
          try {
            const html = document.documentElement.outerHTML;
            const text = document.body ? document.body.innerText.slice(0, 200000) : '';
            return { url: location.href, title: document.title, html, text };
          } catch (e) { return { error: String(e) }; }
        })();`,
                    true,
                );
                if (result && !result.error) return result;
                return null;
            } catch {
                return null;
            }
        };
        window.__execScript = async (fn: any, args: any[]) => {
            const wv = webviewRefs.current[activeTabId];
            if (!wv) return null;
            try {
                args = typeof args[0] === "object" ? JSON.stringify(args[0]) : args[0];
                const result = await wv.executeJavaScript(`(${fn.toString()})(${args})`, true);
                if (result && !result.error) return result;
                return null;
            } catch {
                return null;
            }
        };
    }, [tabs, activeTabId]);
    const agentMessagesRef = useRef<HTMLDivElement | null>(null);
    const [address, setAddress] = useState<string>(HOME_URL); // 显示当前激活 tab 的地址
    const [status, setStatus] = useState<string>("已加载");
    const [navState, setNavState] = useState({ canGoBack: false, canGoForward: false });
    const [conversation, setConversation] = useState<ConversationEntry[]>(() => [
        { id: "welcome", role: "agent", payload: initialAgentMessage, timestamp: Date.now() },
    ]);
    const [openApi, setOpenApi] = useState<{ apiKey: string | null; baseUrl: string | null }>({
        apiKey: null,
        baseUrl: null,
    });
    const [agentStatus, setAgentStatus] = useState("空闲");
    const [isAgentCollapsed, setAgentCollapsed] = useState(false);
    const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
    const [isStreaming, setStreaming] = useState(false);
    const streamCleanupRef = useRef<(() => void) | null>(null);
    const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
    // 记录最近一次 navigate_to 的目标 URL
    const lastNavigateUrlRef = useRef<string | null>(null);

    const updateNavigationState = useCallback(() => {
        const webview = webviewRefs.current[activeTabId];
        if (!webview) return;
        setNavState({ canGoBack: webview.canGoBack(), canGoForward: webview.canGoForward() });
    }, [activeTabId]);

    const loadUrl = useCallback(
        (target: string) => {
            const webview = webviewRefs.current[activeTabId];
            if (!webview) return;
            const finalUrl = normaliseUrl(target);
            setTabs((prev) => prev.map((t) => (t.tabId === activeTabId ? { ...t, url: finalUrl, loading: true } : t)));
            setAddress(finalUrl);
            webview.loadURL(finalUrl);
        },
        [activeTabId],
    );

    const openUrlInNewTab = useCallback((target: string) => {
        const finalUrl = normaliseUrl(target);
        const newId = nextTabIdRef.current++;
        setTabs((prev) => [...prev, { tabId: newId, url: finalUrl, title: "新标签页", loading: true }]);
        setActiveTabId(newId);
        setAddress(finalUrl);
        // 延迟到下一个 tick 访问 ref
        setTimeout(() => {
            const webview = webviewRefs.current[newId];
            webview?.loadURL(finalUrl);
        }, 0);
    }, []);

    const startEditTab = useCallback(
        (tabId: number) => {
            const t = tabs.find((t) => t.tabId === tabId);
            if (!t) return;
            setEditingTabId(tabId);
            setEditingValue(t.url);
        },
        [tabs],
    );

    const commitEditTab = useCallback(() => {
        if (editingTabId == null) return;
        const finalUrl = normaliseUrl(editingValue);
        setTabs((prev) => prev.map((t) => (t.tabId === editingTabId ? { ...t, url: finalUrl, loading: true } : t)));
        if (activeTabId === editingTabId) {
            setAddress(finalUrl);
            const wv = webviewRefs.current[editingTabId];
            wv?.loadURL(finalUrl);
        } else {
            // 预加载对应 webview
            const wv = webviewRefs.current[editingTabId];
            wv?.loadURL(finalUrl);
        }
        setEditingTabId(null);
    }, [editingTabId, editingValue, activeTabId]);

    const cancelEditTab = useCallback(() => {
        setEditingTabId(null);
    }, []);

    const closeTab = useCallback(
        (tabId: number) => {
            setTabs((prev) => prev.filter((t) => t.tabId !== tabId));
            // 如果关闭的是激活 tab，切换到剩余最后一个或首页
            setTimeout(() => {
                setActiveTabId((prevActive) => {
                    if (prevActive === tabId) {
                        const remaining = tabs.filter((t) => t.tabId !== tabId);
                        return remaining.length ? remaining[remaining.length - 1].tabId : 0;
                    }
                    return prevActive;
                });
            }, 0);
        },
        [tabs],
    );

    // 为当前激活 tab 绑定事件监听
    useEffect(() => {
        const webview = webviewRefs.current[activeTabId];
        if (!webview) return;
        const handleDidStartLoading = () => {
            setTabs((prev) => prev.map((t) => (t.tabId === activeTabId ? { ...t, loading: true } : t)));
            setStatus("加载中…");
        };
        const handleDidStopLoading = () => {
            setTabs((prev) => prev.map((t) => (t.tabId === activeTabId ? { ...t, loading: false } : t)));
            setStatus("完成");
            updateNavigationState();
        };
        const handleDidFailLoad = () => setStatus("加载失败，请检查网络或网址");
        const handleDidNavigate = (event: DidNavigateEvent) => {
            if (event.url) {
                setAddress(event.url);
                setTabs((prev) => prev.map((t) => (t.tabId === activeTabId ? { ...t, url: event.url } : t)));
            }
            updateNavigationState();
        };
        const handleDidNavigateInPage = (event: DidNavigateInPageEvent) => {
            if (event.url) {
                setAddress(event.url);
                setTabs((prev) => prev.map((t) => (t.tabId === activeTabId ? { ...t, url: event.url } : t)));
            }
            updateNavigationState();
        };
        const handlePageTitleUpdated = (event: PageTitleUpdatedEvent) => {
            document.title = `${event.title} — AI Native Browser Shell`;
            setTabs((prev) => prev.map((t) => (t.tabId === activeTabId ? { ...t, title: event.title } : t)));
        };
        const handleDomReady = () => {
            updateNavigationState();
            webview.focus();
        };
        webview.addEventListener("did-start-loading", handleDidStartLoading);
        webview.addEventListener("did-stop-loading", handleDidStopLoading);
        webview.addEventListener("did-fail-load", handleDidFailLoad);
        webview.addEventListener("did-navigate", handleDidNavigate as EventListener);
        webview.addEventListener("did-navigate-in-page", handleDidNavigateInPage as EventListener);
        webview.addEventListener("page-title-updated", handlePageTitleUpdated as EventListener);
        webview.addEventListener("dom-ready", handleDomReady);
        return () => {
            webview.removeEventListener("did-start-loading", handleDidStartLoading);
            webview.removeEventListener("did-stop-loading", handleDidStopLoading);
            webview.removeEventListener("did-fail-load", handleDidFailLoad);
            webview.removeEventListener("did-navigate", handleDidNavigate as EventListener);
            webview.removeEventListener("did-navigate-in-page", handleDidNavigateInPage as EventListener);
            webview.removeEventListener("page-title-updated", handlePageTitleUpdated as EventListener);
            webview.removeEventListener("dom-ready", handleDomReady);
        };
    }, [activeTabId, updateNavigationState]);

    useEffect(() => {
        const nativeAPI = window.nativeAPI;
        if (!nativeAPI?.onOpenUrlInTab) {
            return;
        }

        nativeAPI.onOpenUrlInTab((url: string) => {
            // 默认在新标签打开
            openUrlInNewTab(url);
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
        const nativeAPI = window.nativeAPI;
        nativeAPI?.getOpenAIConfig?.().then((config) => {
            if (!config) {
                return;
            }

            setOpenApi({
                apiKey: config.apiKey,
                baseUrl: config.baseUrl,
            });
        });
    }, []);

    useEffect(() => {
        if (!agentMessagesRef.current) {
            return;
        }

        agentMessagesRef.current.scrollTo({
            top: agentMessagesRef.current.scrollHeight,
            behavior: "smooth",
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

    // 监听来自 ExtendedBrowserAgent 的跨站导航事件
    useEffect(() => {
        const navHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.url) {
                // 在当前激活 tab 中导航
                loadUrl(detail.url);
            }
        };
        const switchHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (typeof detail?.tabId === "number") {
                setActiveTabId(detail.tabId);
                const t = tabs.find((t) => t.tabId === detail.tabId);
                if (t) setAddress(t.url);
            }
        };
        window.addEventListener("agent:navigate", navHandler as EventListener);
        window.addEventListener("agent:switch-tab", switchHandler as EventListener);
        return () => {
            window.removeEventListener("agent:navigate", navHandler as EventListener);
            window.removeEventListener("agent:switch-tab", switchHandler as EventListener);
        };
    }, [loadUrl, tabs]);

    // 顶部地址栏已移除，地址编辑通过 Tab 内联完成

    const handleAgentSubmit = useCallback(
        (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();

            // 生产方案：如果主进程返回的 baseUrl 不含 127.0.0.1 代理端口，尝试使用 /v1 让 vite (开发) 或本地代理兜底。
            let effectiveBaseUrl = openApi.baseUrl;
            if (!effectiveBaseUrl) {
                effectiveBaseUrl = "/v1";
            }
            console.info("[OpenAI config]", {
                baseUrl: effectiveBaseUrl,
                apiKey: openApi.apiKey ? "***" : null,
            });

            const form = event.currentTarget;
            const formData = new FormData(form);
            const message = String(formData.get("message") ?? "").trim();

            if (!message) {
                return;
            }

            const userEntry: ConversationEntry = {
                id: createMessageId(),
                role: "user",
                text: message,
                timestamp: Date.now(),
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
            setAgentStatus("Agent 正在处理…");

            // 分隔上一轮任务，插入一条分隔说明（系统样式：使用特殊前缀，避免与普通回复混淆）
            setConversation((prev) => [
                ...prev,
                {
                    id: createMessageId(),
                    role: "agent",
                    payload: {
                        taskId,
                        agentName: "AI Navigator",
                        type: "text",
                        streamId: `separator-${taskId}`,
                        streamDone: true,
                        text: "—— 新任务开始 ——",
                    } as StreamCallbackMessage,
                    timestamp: Date.now(),
                },
            ]);

            // 切换到真实的 Agent streaming
            const cleanup = realAgentRun({
                prompt: message,
                currentUrl: address || HOME_URL,
                taskId,
                agentName: "AI Navigator",
                openApiConfig: {
                    baseUrl: effectiveBaseUrl,
                    apiKey: openApi.apiKey,
                },
                onMessage: (incoming: EkoStreamMessage) => {
                    // 将 Eko 原始消息映射/窄化为本地类型（字段保持一致或子集）
                    const payload = incoming as unknown as StreamCallbackMessage;
                    setConversation((prev) => {
                        const updated = [...prev];

                        const findMergeIndex = (): number => {
                            switch (payload.type) {
                                case "text":
                                case "thinking":
                                case "tool_running":
                                    return updated.findIndex(
                                        (e) =>
                                            e.role === "agent" &&
                                            e.payload.type === payload.type &&
                                            "streamId" in e.payload &&
                                            e.payload.streamId === (payload as any).streamId &&
                                            e.payload.taskId === payload.taskId &&
                                            !e.payload.streamDone,
                                    );
                                case "workflow":
                                    return updated.findIndex(
                                        (e) =>
                                            e.role === "agent" &&
                                            e.payload.type === "workflow" &&
                                            e.payload.taskId === payload.taskId &&
                                            !e.payload.streamDone,
                                    );
                                case "tool_streaming":
                                    return updated.findIndex(
                                        (e) =>
                                            e.role === "agent" &&
                                            e.payload.type === "tool_streaming" &&
                                            e.payload.toolId === (payload as any).toolId &&
                                            e.payload.taskId === payload.taskId,
                                    );
                                case "tool_result":
                                case "agent_result":
                                case "agent_start":
                                case "error":
                                case "finish":
                                case "tool_use":
                                    for (let i = updated.length - 1; i >= 0; i--) {
                                        const e = updated[i];
                                        if (
                                            e.role === "agent" &&
                                            e.payload.type === payload.type &&
                                            e.payload.taskId === payload.taskId
                                        )
                                            return i;
                                    }
                                    return -1;
                                default:
                                    return -1;
                            }
                        };

                        const idx = findMergeIndex();
                        if (idx >= 0) {
                            const target = updated[idx];
                            if (target.role === "agent") {
                                const oldPayload = target.payload;
                                if (
                                    (oldPayload.type === "text" ||
                                        oldPayload.type === "thinking" ||
                                        oldPayload.type === "tool_running") &&
                                    payload.type === oldPayload.type
                                ) {
                                    updated[idx] = {
                                        ...target,
                                        payload: {
                                            ...oldPayload,
                                            text: (oldPayload as any).text + (payload as any).text,
                                            streamDone: (payload as any).streamDone,
                                        },
                                    };
                                    return updated;
                                }
                                if (oldPayload.type === "workflow" && payload.type === "workflow") {
                                    const oldSteps = oldPayload.workflow.steps ?? [];
                                    const newSteps = payload.workflow.steps ?? [];
                                    const map = new Map<string, (typeof oldSteps)[number]>();
                                    [...oldSteps, ...newSteps].forEach((s) => {
                                        if (!map.has(s.id)) map.set(s.id, s);
                                    });
                                    updated[idx] = {
                                        ...target,
                                        payload: {
                                            ...oldPayload,
                                            streamDone: payload.streamDone,
                                            workflow: {
                                                ...oldPayload.workflow,
                                                ...payload.workflow,
                                                steps: [...map.values()],
                                            },
                                        },
                                    };
                                    return updated;
                                }
                                if (oldPayload.type === "tool_streaming" && payload.type === "tool_streaming") {
                                    updated[idx] = {
                                        ...target,
                                        payload: {
                                            ...oldPayload,
                                            paramsText: (oldPayload as any).paramsText + (payload as any).paramsText,
                                        },
                                    };
                                    return updated;
                                }
                                if (oldPayload.type === "tool_result" && payload.type === "tool_result") {
                                    updated[idx] = {
                                        ...target,
                                        payload: {
                                            ...oldPayload,
                                            toolResult: { ...oldPayload.toolResult, ...payload.toolResult },
                                            params: { ...oldPayload.params, ...payload.params },
                                        },
                                    };
                                    return updated;
                                }
                                if (oldPayload.type === "agent_result" && payload.type === "agent_result") {
                                    updated[idx] = {
                                        ...target,
                                        payload: {
                                            ...oldPayload,
                                            result: payload.result ?? oldPayload.result,
                                            error: payload.error ?? oldPayload.error,
                                        },
                                    };
                                    return updated;
                                }
                                if (oldPayload.type === "agent_start" && payload.type === "agent_start") {
                                    updated[idx] = {
                                        ...target,
                                        payload: {
                                            ...oldPayload,
                                            agentNode: { ...oldPayload.agentNode, ...payload.agentNode },
                                        },
                                    };
                                    return updated;
                                }
                                if (oldPayload.type === "error" && payload.type === "error") {
                                    updated[idx] = { ...target, payload: { ...oldPayload, error: payload.error } };
                                    return updated;
                                }
                                if (oldPayload.type === "finish" && payload.type === "finish") {
                                    updated[idx] = {
                                        ...target,
                                        payload: {
                                            ...oldPayload,
                                            finishReason: payload.finishReason,
                                            usage: payload.usage,
                                        },
                                    };
                                    return updated;
                                }
                                if (oldPayload.type === "tool_use" && payload.type === "tool_use") {
                                    updated[idx] = {
                                        ...target,
                                        payload: { ...oldPayload, params: { ...oldPayload.params, ...payload.params } },
                                    };
                                    return updated;
                                }
                            }
                        }
                        updated.push({ id: createMessageId(), role: "agent", payload, timestamp: Date.now() });
                        return updated;
                    });

                    switch (payload.type) {
                        case "workflow":
                            setAgentStatus(payload.streamDone ? "工作流完成" : "工作流执行中…");
                            if (payload.streamDone) {
                                setStreaming(false);
                            }
                            break;
                        case "thinking":
                            setAgentStatus("Agent 正在思考…");
                            break;
                        case "text": {
                            setAgentStatus(payload.streamDone ? "Agent 完成回复" : "Agent 正在回答…");
                            if (payload.streamDone) {
                                // 最终完成标记：可以在最后一条累积消息上再追加一次（已由上面合并逻辑处理）
                                setStreaming(false);
                            }
                            break;
                        }
                        case "tool_use": {
                            if (payload.toolName === "navigate_to") {
                                // 记录尝试导航的 URL（不同 SDK 里参数字段名可能不同，做多种兼容）
                                const params: any = (payload as any).params || {};
                                const navUrl = params.url || params.target || params.href;
                                if (typeof navUrl === "string") {
                                    lastNavigateUrlRef.current = navUrl;
                                }
                            }
                            break;
                        }
                        case "tool_running":
                            setAgentStatus(`调用工具：${payload.toolName}`);
                            break;
                        case "tool_result":
                            setAgentStatus(`工具 ${payload.toolName} 返回结果`);
                            break;
                        case "error":
                            setAgentStatus("Agent 出错");
                            setStreaming(false);
                            // 处理 navigate_to 跨站限制：自动用宿主 webview 打开页面
                            try {
                                const errString = JSON.stringify((payload as any).error) || "";
                                if (lastNavigateUrlRef.current && /Unable to access other websites/.test(errString)) {
                                    const target = lastNavigateUrlRef.current;
                                    // 调用主进程 / 预加载暴露的 API 打开真实页面
                                    // 尝试使用主进程能力打开；如果没有对应 API，回退到当前 webview 加载
                                    if (window.nativeAPI?.createNewWindow) {
                                        window.nativeAPI.createNewWindow(target);
                                    } else {
                                        loadUrl(target);
                                    }
                                    // 插入提示消息
                                    setConversation((prev) => [
                                        ...prev,
                                        {
                                            id: createMessageId(),
                                            role: "agent",
                                            payload: {
                                                taskId: currentTaskId || createMessageId(),
                                                agentName: "AI Navigator",
                                                type: "text",
                                                streamId: `nav-notice-${Date.now()}`,
                                                streamDone: true,
                                                text: `已在外部 webview 打开：${target}\n请等待页面加载后重新提问以分析新页面。`,
                                            } as StreamCallbackMessage,
                                            timestamp: Date.now(),
                                        },
                                    ]);
                                    // 清除，避免重复处理
                                    lastNavigateUrlRef.current = null;
                                }
                            } catch {}
                            break;
                        case "finish":
                            setAgentStatus("空闲");
                            setStreaming(false);
                            streamCleanupRef.current = null;
                            break;
                        default:
                            break;
                    }
                },
                onComplete: () => {
                    setStreaming(false);
                    setAgentStatus("空闲");
                    streamCleanupRef.current = null;
                },
                onError: () => {
                    setStreaming(false);
                    setAgentStatus("Agent 出错");
                    streamCleanupRef.current = null;
                },
            });

            streamCleanupRef.current = cleanup;
        },
        [address],
    );

    // 快捷键：Cmd/Ctrl+Enter 发送；Esc 取消当前流
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                const form = document.getElementById("agent-input")?.closest("form");
                if (form && !isStreaming) {
                    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
                }
            } else if (e.key === "Escape") {
                if (isStreaming && streamCleanupRef.current) {
                    streamCleanupRef.current();
                    streamCleanupRef.current = null;
                    setStreaming(false);
                    setAgentStatus("已取消");
                    setConversation((prev) => [
                        ...prev,
                        {
                            id: createMessageId(),
                            role: "agent",
                            payload: {
                                taskId: createMessageId(),
                                agentName: "AI Navigator",
                                type: "text",
                                streamId: `cancel-${Date.now()}`,
                                streamDone: true,
                                text: "【任务已取消】",
                            } as StreamCallbackMessage,
                            timestamp: Date.now(),
                        },
                    ]);
                }
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [isStreaming]);

    const handleNewWindow = useCallback(() => {
        openUrlInNewTab(HOME_URL);
    }, [openUrlInNewTab]);

    const handleToggleDevtools = useCallback(() => {
        window.nativeAPI?.toggleDevtools?.();
    }, []);

    const appInfoText = useMemo(() => {
        if (!appInfo) {
            return "";
        }

        return `App ${appInfo.version} · Electron ${appInfo.electron} · Chromium ${appInfo.chrome}`;
    }, [appInfo]);

    const toolbarButtonClass =
        "rounded-md bg-white/10 px-2.5 py-1.5 text-sm text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40";

    const actionButtonClass = "rounded-md bg-white/10 px-3 py-1.5 text-sm text-white transition hover:bg-white/20";

    const agentPanelBaseClasses =
        "flex h-full w-[340px] min-w-[280px] flex-col border-l border-white/10 bg-[rgba(17,18,30,0.95)] backdrop-blur-xl transition-all duration-200 ease-in-out";

    const agentPanelClasses = isAgentCollapsed ? `${agentPanelBaseClasses} w-16 min-w-0` : agentPanelBaseClasses;

    return (
        <div className="flex h-full flex-col bg-surface">
            <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-gradient-to-r from-[#1a1c2c] to-[#13141f] px-3 py-2">
                <div className="text-xs text-white/50">AI Native Browser</div>
                <div className="flex items-center gap-2">
                    <button type="button" title="新建标签页" onClick={handleNewWindow} className={actionButtonClass}>
                        ＋
                    </button>
                    <button
                        type="button"
                        title="开发者工具"
                        onClick={handleToggleDevtools}
                        className={actionButtonClass}
                    >
                        {"{ }"}
                    </button>
                </div>
            </header>

            <main className="flex flex-1 min-h-0 bg-transparent">
                <section className="flex-1 min-w-0 flex flex-col p-3 pr-0">
                    {/* Tab Bar */}
                    <div className="mb-2 flex items-center gap-1 overflow-x-auto whitespace-nowrap rounded-md bg-white/5 px-2 py-1 text-xs">
                        {/* 导航按钮移入 Tab Bar，避免重复地址栏 */}
                        <div className="flex items-center gap-1 pr-1 border-r border-white/10">
                            <button
                                type="button"
                                title="后退"
                                onClick={() => webviewRefs.current[activeTabId]?.goBack()}
                                disabled={!navState.canGoBack}
                                className="rounded bg-white/10 px-1.5 py-1 text-white/80 hover:bg-white/20 disabled:opacity-30"
                            >
                                ⟨
                            </button>
                            <button
                                type="button"
                                title="前进"
                                onClick={() => webviewRefs.current[activeTabId]?.goForward()}
                                disabled={!navState.canGoForward}
                                className="rounded bg-white/10 px-1.5 py-1 text-white/80 hover:bg-white/20 disabled:opacity-30"
                            >
                                ⟩
                            </button>
                            <button
                                type="button"
                                title="刷新"
                                onClick={() => webviewRefs.current[activeTabId]?.reload()}
                                className="rounded bg-white/10 px-1.5 py-1 text-white/80 hover:bg-white/20"
                            >
                                ⟳
                            </button>
                            <button
                                type="button"
                                title="首页"
                                onClick={() => loadUrl(HOME_URL)}
                                className="rounded bg-white/10 px-1.5 py-1 text-white/80 hover:bg-white/20"
                            >
                                ⌂
                            </button>
                        </div>
                        {tabs.map((t) => (
                            <div
                                key={t.tabId}
                                className={`flex items-center gap-1 rounded px-2 py-1 cursor-pointer transition ${t.tabId === activeTabId ? "bg-blue-600/30 text-white" : "bg-transparent text-white/70 hover:bg-white/10"}`}
                                onClick={() => setActiveTabId(t.tabId)}
                                onDoubleClick={() => startEditTab(t.tabId)}
                            >
                                {editingTabId === t.tabId ? (
                                    <form
                                        onSubmit={(e) => {
                                            e.preventDefault();
                                            commitEditTab();
                                        }}
                                        className="flex items-center gap-1"
                                    >
                                        <input
                                            autoFocus
                                            value={editingValue}
                                            onChange={(e) => setEditingValue(e.target.value)}
                                            onBlur={commitEditTab}
                                            onKeyDown={(e) => {
                                                if (e.key === "Escape") {
                                                    e.preventDefault();
                                                    cancelEditTab();
                                                }
                                            }}
                                            spellCheck={false}
                                            className="w-[180px] rounded bg-black/40 px-1 py-0.5 text-[11px] text-white outline-none ring-1 ring-white/20 focus:ring-blue-400/60"
                                        />
                                    </form>
                                ) : (
                                    <span className="max-w-[160px] truncate" title={t.url}>
                                        {t.title || t.url}
                                    </span>
                                )}
                                {t.loading && (
                                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                                )}
                                {tabs.length > 1 && (
                                    <button
                                        type="button"
                                        className="ml-1 text-white/40 hover:text-white/80"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            closeTab(t.tabId);
                                        }}
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        ))}
                        {/* 快速新增标签输入 */}
                        <InlineNewTabInput onSubmitUrl={openUrlInNewTab} />
                    </div>
                    {/* Active Webview Stack */}
                    <div className="flex-1 relative">
                        {tabs.map((t) => (
                            <webview
                                key={t.tabId}
                                ref={(el) => {
                                    webviewRefs.current[t.tabId] = el as unknown as WebviewTag | null;
                                }}
                                className={`absolute inset-0 h-full w-full rounded-lg border border-white/5 bg-black/40 ${t.tabId === activeTabId ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
                                data-active={t.tabId === activeTabId ? "true" : "false"}
                                src={t.url}
                                allowpopups
                                disableblinkfeatures="AutomationControlled"
                            />
                        ))}
                    </div>
                </section>

                <aside className={agentPanelClasses} aria-label="AI 交互区">
                    <header
                        className={`flex w-full items-center gap-3 border-b border-white/10 px-4 py-3 ${
                            isAgentCollapsed ? "justify-center" : "justify-between"
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
                            {isAgentCollapsed ? "⟫" : "⟪"}
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
                                    if (entry.role === "user") {
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
                                        case "thinking":
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="flex flex-col gap-1 text-sm leading-relaxed text-white/80"
                                                >
                                                    <span className="text-xs font-medium text-white/60">
                                                        Agent 正在思考…
                                                    </span>
                                                    <p className="w-fit max-w-full rounded-lg bg-white/5 px-3 py-2 italic text-white/80">
                                                        {payload.text}
                                                    </p>
                                                </div>
                                            );
                                        case "text":
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="flex flex-col gap-1 text-sm leading-relaxed"
                                                >
                                                    <span className="text-xs font-medium text-white/60">
                                                        Agent {payload.streamDone ? "回复完成" : "正在回复…"}
                                                    </span>
                                                    <p className="w-fit max-w-full rounded-lg bg-white/10 px-3 py-2 text-white">
                                                        {payload.text}
                                                    </p>
                                                </div>
                                            );
                                        case "tool_streaming":
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="flex flex-col gap-1 text-sm leading-relaxed"
                                                >
                                                    <span className="text-xs font-medium text-amber-300/90">
                                                        调用工具 {payload.toolName}
                                                    </span>
                                                    <pre className="w-full max-w-full overflow-auto rounded-lg bg-black/40 px-3 py-2 text-xs text-amber-100/90">
                                                        {payload.paramsText}
                                                    </pre>
                                                </div>
                                            );
                                        case "tool_running":
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="flex flex-col gap-1 text-sm leading-relaxed text-sky-200/90"
                                                >
                                                    <span className="text-xs font-medium text-sky-300/90">
                                                        工具 {payload.toolName} 正在执行…
                                                    </span>
                                                    <p className="w-fit max-w-full rounded-lg bg-sky-500/20 px-3 py-2 text-sky-100">
                                                        {payload.text}
                                                    </p>
                                                </div>
                                            );
                                        case "tool_use":
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="flex flex-col gap-1 text-sm leading-relaxed text-indigo-100/90"
                                                >
                                                    <span className="text-xs font-medium text-indigo-300/90">
                                                        调用工具 {payload.toolName} 参数
                                                    </span>
                                                    <pre className="w-full max-w-full overflow-auto rounded-lg bg-indigo-500/20 px-3 py-2 text-xs text-indigo-100">
                                                        {JSON.stringify(payload.params, null, 2)}
                                                    </pre>
                                                </div>
                                            );
                                        case "tool_result":
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="flex flex-col gap-1 text-sm leading-relaxed text-emerald-100/90"
                                                >
                                                    <span className="text-xs font-medium text-emerald-300/90">
                                                        工具 {payload.toolName} 返回结果
                                                    </span>
                                                    <pre className="w-full max-w-full overflow-auto rounded-lg bg-emerald-500/20 px-3 py-2 text-xs text-emerald-100">
                                                        {JSON.stringify(payload.toolResult, null, 2)}
                                                    </pre>
                                                </div>
                                            );
                                        case "workflow":
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="flex flex-col gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-white/80"
                                                >
                                                    <div className="text-xs font-medium text-white/60">
                                                        工作流：{payload.workflow.name}
                                                    </div>
                                                    {payload.workflow.steps?.map((step) => (
                                                        <div
                                                            key={step.id}
                                                            className="flex items-start gap-2 text-xs text-white/70"
                                                        >
                                                            <span className="mt-1 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px]">
                                                                {step.title[0]?.toUpperCase() ?? "•"}
                                                            </span>
                                                            <div>
                                                                <div className="font-semibold text-white/80">
                                                                    {step.title}
                                                                </div>
                                                                {step.description && (
                                                                    <div className="text-white/60">
                                                                        {step.description}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        case "agent_start":
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="flex flex-col gap-1 text-sm leading-relaxed text-white/70"
                                                >
                                                    <span className="text-xs font-medium text-white/50">
                                                        Agent 启动
                                                    </span>
                                                    <div className="rounded-lg bg-white/5 px-3 py-2">
                                                        <div className="text-sm text-white/80">
                                                            {payload.agentNode.name}
                                                        </div>
                                                        {payload.agentNode.description && (
                                                            <div className="text-xs text-white/60">
                                                                {payload.agentNode.description}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        case "agent_result":
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="flex flex-col gap-1 text-sm leading-relaxed text-emerald-100/90"
                                                >
                                                    <span className="text-xs font-medium text-emerald-200/90">
                                                        Agent 结果
                                                    </span>
                                                    <p className="w-fit max-w-full rounded-lg bg-emerald-500/20 px-3 py-2 text-emerald-100">
                                                        {payload.result ?? "Agent 完成"}
                                                    </p>
                                                </div>
                                            );
                                        case "error":
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="flex flex-col gap-1 text-sm leading-relaxed text-rose-100/90"
                                                >
                                                    <span className="text-xs font-medium text-rose-300/90">
                                                        Agent 出错
                                                    </span>
                                                    <pre className="w-full max-w-full overflow-auto rounded-lg bg-rose-500/20 px-3 py-2 text-xs text-rose-100">
                                                        {JSON.stringify(payload.error, null, 2)}
                                                    </pre>
                                                </div>
                                            );
                                        case "finish":
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="flex flex-col gap-1 text-xs leading-relaxed text-white/50"
                                                >
                                                    <span className="font-medium text-white/60">会话结束</span>
                                                    <span>原因：{payload.finishReason}</span>
                                                    <span>
                                                        Token 用量：prompt {payload.usage.promptTokens} · completion{" "}
                                                        {payload.usage.completionTokens} · total
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
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="submit"
                                            disabled={isStreaming}
                                            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#4a7afe] to-[#6e61ff] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {isStreaming && (
                                                <span className="inline-flex h-3 w-3 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
                                            )}
                                            {isStreaming ? "生成中…" : "发送 (⌘/Ctrl+Enter)"}
                                        </button>
                                        {isStreaming && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (streamCleanupRef.current) {
                                                        streamCleanupRef.current();
                                                        streamCleanupRef.current = null;
                                                    }
                                                    setStreaming(false);
                                                    setAgentStatus("已取消");
                                                    setConversation((prev) => [
                                                        ...prev,
                                                        {
                                                            id: createMessageId(),
                                                            role: "agent",
                                                            payload: {
                                                                taskId: createMessageId(),
                                                                agentName: "AI Navigator",
                                                                type: "text",
                                                                streamId: `cancel-${Date.now()}`,
                                                                streamDone: true,
                                                                text: "【任务已取消】",
                                                            } as StreamCallbackMessage,
                                                            timestamp: Date.now(),
                                                        },
                                                    ]);
                                                }}
                                                className="rounded-lg bg-rose-600/80 px-3 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-rose-600"
                                            >
                                                取消 (Esc)
                                            </button>
                                        )}
                                    </div>
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

// 新建标签页内联输入组件
function InlineNewTabInput({ onSubmitUrl }: { onSubmitUrl: (url: string) => void }) {
    const [value, setValue] = useState("");
    const [focused, setFocused] = useState(false);
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                const v = value.trim();
                if (v) {
                    onSubmitUrl(v);
                    setValue("");
                }
            }}
            className={`ml-2 flex items-center gap-1 ${focused ? "ring-1 ring-blue-500/60 rounded px-1 py-0.5 bg-black/30" : ""}`}
        >
            <input
                placeholder="新标签 URL 或关键词"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                spellCheck={false}
                className="w-[150px] bg-transparent text-white/70 placeholder:text-white/30 text-[11px] outline-none"
            />
            <button type="submit" title="打开" className="text-white/50 hover:text-white/90 text-xs">
                ↵
            </button>
        </form>
    );
}
