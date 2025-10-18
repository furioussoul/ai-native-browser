import type { WebviewTag } from 'electron';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { NativeAPI } from '../preload';

declare global {
  interface Window {
    nativeAPI?: NativeAPI;
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
