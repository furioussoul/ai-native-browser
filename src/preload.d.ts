export interface NativeAPI {
  toggleDevtools?: () => Promise<void> | void;
  focusWindow?: () => Promise<void> | void;
  createNewWindow?: (url: string) => Promise<void> | void;
  onOpenUrlInTab?: (callback: (url: string) => void) => void;
  getAppInfo?: () => Promise<{
    name: string;
    version: string;
    electron: string;
    chrome: string;
    node: string;
  }>;
}
