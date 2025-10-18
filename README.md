# Electron Browser Demo

一个基于 Electron + React + TypeScript + Vite + Tailwind CSS 的轻量级浏览器壳，后续可以扩展为 AI Native 浏览器。

## 功能特性

- ✅ Electron + Chromium 内核，支持现代网页特性
- ✅ React 组件化渲染层 + Tailwind CSS 原子化样式
- ✅ TypeScript 强类型约束
- ✅ Agent 面板内置 SSE Mock，可根据返回类型展示多态 UI
- ✅ 自定义导航栏：后退 / 前进 / 刷新 / 首页 / 地址栏
- ✅ 输入网址或关键词，自动判断打开网页或搜索
- ✅ 统一在单窗口内拦截弹窗，可选择新建 Electron 窗口
- ✅ 状态栏展示加载状态与内核版本信息
- ✅ 通过 `preload` 层隔离，便于后续扩展原生 AI 能力

## 快速开始

```bash
npm install
npm run dev            # 终端 A：启动 Vite + Electron 热重载
# 或者分开运行：
# 终端 A：npm run dev:renderer
# 终端 B：npm run dev:electron
```

> `npm run dev` 会同时启动 Vite（渲染层热更新）和 Electron 主进程。

生产/预览构建：

```bash
npm run build
npm run start         # 使用构建产物启动 Electron
```

## 目录结构

```
.
├─ index.html              # Vite 入口模板
├─ src/
│  ├─ main.js              # Electron 主进程入口
│  ├─ preload.js           # 安全向渲染层暴露 API
│  ├─ preload.d.ts         # preload 暴露 API 的类型定义
│  └─ renderer/
│     ├─ App.tsx           # React 组件主体（Tailwind 样式 + Agent SSE Mock）
│     ├─ index.css         # Tailwind CSS 入口
│     ├─ main.tsx          # React 挂载入口
│     ├─ services/mockAgent.ts # 模拟 SSE agent 推理
│     └─ types/agent.ts    # Agent 消息类型定义
│     ├─ global.d.ts       # webview 与 window.nativeAPI 类型补充
│     ├─ index.html        # 旧版占位（可删除）
│     └─ renderer.js       # 旧版占位（可删除）
├─ tsconfig.json
├─ vite.config.ts
├─ package.json
└─ README.md
```

## 自定义建议

- 修改默认首页 / 搜索引擎：在 `src/renderer/App.tsx` 中更新 `HOME_URL`、`SEARCH_BASE`
- 注入 AI 原生能力：在 `src/preload.js` 中扩展 `nativeAPI`，并更新 `preload.d.ts`
- 扩展多标签页：在 React 状态中维护标签列表，动态挂载 `<webview>`
- 结合 AI Agent：在 `App.tsx` 中接入模型推理或自建服务，通过 `nativeAPI` 获取本地能力
- 替换真实 SSE 接口：可在 `mockAgentSSE` 中改为 `fetch`/`EventSource` 调用 `https://oneai.17usoft.com/v1/chat/completions`

## 开发提示

- 推荐开启 `开发者工具`（导航栏右上角）观察页面行为
- 渲染层默认禁止 Node.js API，确保安全，可通过 `preload` 单点下发
- TypeScript 严格模式已启用，欢迎补全更多类型定义保持可维护性
- 若要打包，请参考 [Electron Forge](https://www.electronforge.io/) 或 [electron-builder](https://www.electron.build/)

祝你打造强大的 AI 原生浏览器 🚀
