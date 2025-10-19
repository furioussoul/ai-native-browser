import type { WebviewTag } from 'electron';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { NativeAPI } from '../preload';

declare global {
  interface Window {
    nativeAPI?: NativeAPI;
    /** Agent 能读取的所有 Tab 列表（由宿主页面维护） */
    __tabs?: Array<{ tabId: number; url: string; title: string }>;
    /** 当前激活的 Tab ID */
    __activeTabId?: number;
    /** 当前激活 Tab 的 URL（避免直接使用 location.href 仍是宿主页面的 Vite 地址） */
    __activeTabUrl?: string;
    /** 获取当前激活标签页页面快照（来自 webview 内部） */
    __getActivePageSnapshot?: () => Promise<{
      url: string;
      title: string;
      html: string;
      text: string;
    } | null>;
    /** 获取当前激活标签页可点击元素信息和 element_str */
    __getActivePageClickableElements?: () => Promise<{
      element_str: string;
      elements: Array<{
        index: number;
        tag: string;
        text: string;
        html: string;
        rect: { x: number; y: number; width: number; height: number };
      }>;
    } | null>;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<
        HTMLAttributes<WebviewTag> & {
          src?: string;
          allowpopups?: boolean;
          disableblinkfeatures?: string;
        },
        WebviewTag
      >;
    }
  }
}

export {};
