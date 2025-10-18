<div align="center">
<h1>AI Native Browser Shell</h1>
<p><strong>Electron + React + TypeScript + Vite + Tailwind CSS</strong> 的轻量浏览器壳 & 可扩展 AI Agent 面板。</p>
<p>
	<img alt="Electron" src="https://img.shields.io/badge/Electron-31.x-47848F?logo=electron" />
	<img alt="React" src="https://img.shields.io/badge/React-18-61DBFB?logo=react" />
	<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" />
	<img alt="Vite" src="https://img.shields.io/badge/Vite-5-purple?logo=vite" />
	<img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-3-38BDF8?logo=tailwindcss" />
</p>
</div>

## ✨ 特性一览

- 🚀 基于 Electron + Chromium，获得现代 Web 能力
- ⚛️ 使用 React + TS 构建 UI，严格类型，易维护
- 🎨 Tailwind CSS 原子化样式，快速迭代界面
- 🧠 右侧 Agent 面板，内置可扩展的 SSE Mock 流式消息类型（思考 / 工具调用 / 结果 / 错误 / 完成等）
- 🔐 通过 `preload` 隔离主进程与渲染层，仅暴露白名单 API
- 🧭 自定义导航：后退 / 前进 / 刷新 / 首页 / 地址栏智能 URL or 搜索
- 🪟 弹窗策略：拦截 `window.open` 可选择新建 Electron 窗口
- 📡 统一的流清理机制 `streamCleanupRef` 防止重复订阅泄漏
- 🛠️ 可平滑切换到真实后端 SSE（EventSource / fetch streaming）

## 🗂️ 项目结构

```
.
├─ index.html                # Vite HTML 模板
├─ package.json              # 脚本与依赖
├─ tsconfig.json             # TS 编译配置（严格模式 + sourceMap）
├─ tailwind.config.js        # Tailwind 配置
├─ postcss.config.js         # PostCSS 管道 (tailwind + autoprefixer)
├─ vite.config.ts            # Vite 配置 (端口, alias '@')
├─ .env.dev                  # 开发环境变量 (VITE_DEV_SERVER_URL 等)
├─ scripts/
│  └─ dev-renderer-nvm.sh    # 使用 nvm 启动 renderer, 解决 ICU/Node 冲突
└─ src/
	 ├─ main.js                # Electron 主进程入口 (创建 BrowserWindow + IPC)
	 ├─ preload.js             # 受控暴露 nativeAPI 到渲染层
	 ├─ preload.d.ts           # preload 暴露 API 类型声明
	 └─ renderer/
			├─ main.tsx            # React 应用挂载入口
			├─ App.tsx             # 主界面 + Agent 面板逻辑 + webview 控制
			├─ index.css           # Tailwind 指令 & 全局高度样式
			├─ global.d.ts         # window.nativeAPI / webview 类型补充
			├─ services/
			│  └─ mockAgent.ts     # 模拟 SSE 流消息 (thinking/tool/...)
			└─ types/
				 └─ agent.ts         # Agent 消息与回调类型定义
```

> 旧的占位或未使用文件已经被清理；如仍存在历史遗留可安全删除。

## 🧪 环境要求

- Node.js：推荐使用 nvm 管理（避免 Homebrew 导致的 ICU 库缺失）。
- macOS / Windows / Linux 均可（示例基于 macOS）。
- VS Code（调试配置可选）。

## 📦 安装依赖

```bash
npm install
```

如果你使用 nvm：
```bash
nvm install 22
nvm use 22
```

## 🧑‍💻 开发模式

三种常用方式：

1. 一键并行（简单）：
```bash
npm run dev
```
2. 分离两个终端：
```bash
npm run dev:renderer   # 启动 Vite (端口 5173)
VITE_DEV_SERVER_URL=http://localhost:5173 electron .   # 或 npm run dev:electron
```
3. 带调试端口（主进程 Inspect）：
```bash
npm run dev:debug       # Electron --inspect=9229
npm run dev:debug-brk   # 断点前暂停
```

使用脚本强制 nvm Node：
```bash
bash scripts/dev-renderer-nvm.sh
```

## 🐞 调试技巧

| 场景 | 方法 |
|------|------|
| 主进程断点 | `npm run dev:debug` 然后在 VS Code 选择 Attach (端口 9229) |
| 渲染进程 | 打开 Electron 内部 DevTools 或用 `--remote-debugging-port=9222` attach |
| Source Map 无效 | 确认 `tsconfig.json` 已启用 `sourceMap` 与 `inlineSources` |
| webview 调试 | 在 DevTools Elements 中选中 `<webview>`，使用其内部 DevTools |

常见问题：
1. Node ICU 错误：确保不是 `/opt/homebrew/Cellar/node/...` 路径，使用 `nvm use 22`。
2. 主进程不随 Vite 启动：检查 VS Code `preLaunchTask` 的问题匹配 (problemMatcher) 是否正确结束。
3. 端口冲突：确保 5173 未占用；若占用 Vite 会改端口，需要同步 `VITE_DEV_SERVER_URL`。

## 🧱 编译与生产运行

构建静态资源（React + Tailwind）：
```bash
npm run build
```
启动生产模式（加载 `dist` 构建）：
```bash
npm run start
```
此时 `main.js` 会检测 `process.env.VITE_DEV_SERVER_URL` 是否存在：不存在则加载本地 `dist` 文件。

## 📦 打包发布（建议）

选择其一：
1. electron-builder：快速生成 dmg / exe / AppImage。
2. Electron Forge：脚手架 + Maker/Publisher 扩展。

示例（electron-builder 简易初始化）：
```bash
npm install --save-dev electron-builder
```
在 `package.json` 增加：
```jsonc
"build": {
	"appId": "com.example.ainativebrowser",
	"files": ["dist/**/*", "src/**/*", "package.json"],
	"mac": { "category": "public.app-category.utilities" }
}
```
然后：
```bash
npm run build    # 先构建前端
npx electron-builder
```

## 🧠 替换真实 Agent SSE

当前 `mockAgentSSE` 模拟分阶段消息。要接入真实后端：
```ts
// services/realAgent.ts
export function realAgentSSE({ prompt, taskId, onMessage, onComplete, onError }) {
	const es = new EventSource(`/api/agent?prompt=${encodeURIComponent(prompt)}`);
	es.onmessage = (e) => onMessage(JSON.parse(e.data));
	es.onerror = () => { es.close(); onError?.(); };
	es.addEventListener('done', () => { es.close(); onComplete?.(); });
	return () => es.close();
}
```
在 `App.tsx` 替换 `mockAgentSSE` 调用即可。

## 🧩 扩展方向建议

- 多标签页 / 分屏浏览
- 会话上下文记忆 & 向量检索
- 工具调用：浏览器 DOM 抽取 / 页面总结 / 网页结构分析
- 插件体系：通过 preload 注入能力，动态注册工具
- 远程调试 / 权限沙盒 / 自动化脚本 (Puppeteer + 内置)

## 🔐 安全注意

- 渲染层禁用 `nodeIntegration`（请保持如此）
- `contextIsolation: true` + 仅暴露 `nativeAPI` 白名单函数
- 避免直接在窗口加载不受信任的 file:// 或远端执行脚本

## 📜 License

MIT

---
如果你在调试或构建过程中遇到阻塞，欢迎继续提问，我可以直接给出针对性的修复补丁。享受构建 AI 原生浏览器的旅程！🚀
