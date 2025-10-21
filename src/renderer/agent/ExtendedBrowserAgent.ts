import { AgentContext, BaseBrowserLabelsAgent } from "@eko-ai/eko";
import html2canvas from "html2canvas";

/**
 * 自定义 BrowserAgent：基于原实现（@eko-ai/eko-web/src/browser.ts）拷贝必要方法，
 * 修改 navigate_to 使其支持跨站，通过触发自定义事件给宿主。
 */
export default class ExtendedBrowserAgent extends BaseBrowserLabelsAgent {
    protected async screenshot(
        agentContext: AgentContext,
    ): Promise<{ imageBase64: string; imageType: "image/jpeg" | "image/png" }> {
        const [width, height] = this.size();
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        const canvas = await html2canvas(document.documentElement || document.body, {
            width,
            height,
            windowWidth: width,
            windowHeight: height,
            x: scrollX,
            y: scrollY,
            scrollX: -scrollX,
            scrollY: -scrollY,
            useCORS: true,
            foreignObjectRendering: true,
        });
        const dataUrl = canvas.toDataURL("image/jpeg");
        const data = dataUrl.substring(dataUrl.indexOf("base64,") + 7);
        return { imageBase64: data, imageType: "image/jpeg" };
    }

    protected async navigate_to(agentContext: AgentContext, url: string): Promise<{ url: string; title?: string }> {
        const trimmed = url.trim();
        const isAbsolute = /^https?:\/\//i.test(trimmed);
        // 使用当前激活 tab 的 URL 作为基准（而不是宿主页面的 Vite 地址）
        const activeUrl = window.__activeTabUrl || location.href;
        let idx = activeUrl.indexOf("/", 10);
        const baseUrl = idx > -1 ? activeUrl.substring(0, idx) : activeUrl;
        if (!isAbsolute) {
            // 相对路径或站内子路径保持原逻辑
            if (trimmed.startsWith("/")) {
                // 更新激活 tab 的 url
                window.__activeTabUrl = baseUrl.replace(/\/$/, "") + trimmed;
            } else if (trimmed.startsWith(baseUrl)) {
                window.__activeTabUrl = trimmed;
            } else {
                // 非绝对且不以 / 开头，视为无法识别格式，抛错让模型改用绝对 URL
                throw new Error("Unsupported relative navigation target: " + url);
            }
            window.dispatchEvent(
                new CustomEvent("agent:tab-update", {
                    detail: { tabId: window.__activeTabId, url: window.__activeTabUrl },
                }),
            );
            return { url: window.__activeTabUrl || activeUrl, title: document.title };
        }
        // 跨站：派发事件供外部 webview 宿主处理实际加载。
        window.dispatchEvent(new CustomEvent("agent:navigate", { detail: { url: trimmed } }));
        window.__activeTabUrl = trimmed;
        return { url: trimmed };
    }

    protected async execute_script(
        agentContext: AgentContext,
        func: (...args: any[]) => void,
        args: any[],
    ): Promise<any> {
        return window.__execScript ? window.__execScript(func, args) : null;
    }

    protected async get_all_tabs(
        agentContext: AgentContext,
    ): Promise<Array<{ tabId: number; url: string; title: string }>> {
        return (window.__tabs || []).map((t) => ({ ...t }));
    }

    protected async switch_tab(
        agentContext: AgentContext,
        tabId: number,
    ): Promise<{ tabId: number; url: string; title: string }> {
        const tabs = await this.get_all_tabs(agentContext);
        const target = tabs.find((t) => t.tabId === tabId) || tabs[0];
        if (!target) throw new Error("No tabs available");
        if (target.tabId !== window.__activeTabId) {
            window.__activeTabId = target.tabId;
            window.__activeTabUrl = target.url;
            window.dispatchEvent(new CustomEvent("agent:switch-tab", { detail: { tabId: target.tabId } }));
        }
        return target;
    }

    /** 返回当前激活标签真实 URL 与标题（不使用宿主 location） */
    protected async get_current_page(agentContext: AgentContext): Promise<{ url: string; title: string }> {
        const url = window.__activeTabUrl || location.href;
        // 标题无法直接从 webview DOM 拿，这里先在 tabs 里找
        const tab = (window.__tabs || []).find((t) => t.tabId === window.__activeTabId);
        return { url, title: tab?.title || document.title };
    }

    /** 重写页面内容抽取：调用宿主提供的 __getActivePageSnapshot，在真实页面上下文执行。 */
    protected async extract_page_content(
        agentContext: AgentContext,
        variable_name?: string,
    ): Promise<{ title: string; page_url: string; page_content: string }> {
        let snapshot = await window.__getActivePageSnapshot?.();
        if (!snapshot) {
            // 兜底：仍然使用宿主页面文本（但会包含右侧 UI）
            snapshot = {
                url: window.__activeTabUrl || location.href,
                title: document.title,
                html: document.documentElement.outerHTML,
                text: document.body?.innerText || "",
            };
        }
        const result = `title: ${snapshot.title}\npage_url: ${snapshot.url}\npage_content:\n${snapshot.text}`;
        if (variable_name) {
            agentContext.context.variables.set(variable_name, result);
        }
        return { title: snapshot.title, page_url: snapshot.url, page_content: snapshot.text };
    }

    private size(): [number, number] {
        return [
            window.innerWidth ||
                document.documentElement.clientWidth ||
                (document.documentElement || document.body).clientWidth,
            window.innerHeight ||
                document.documentElement.clientHeight ||
                (document.documentElement || document.body).clientHeight,
        ];
    }

    private sleep(time: number): Promise<void> {
        return new Promise((r) => setTimeout(r, time));
    }
}
