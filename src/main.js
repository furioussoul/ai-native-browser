const { app, BrowserWindow, Menu, ipcMain, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

// -------- ENV LOADING (dotenv) --------
// 支持优先顺序：.env.<mode>.local > .env.<mode> > .env.local(非生产) > .env
// 这样既兼容 Vite 的约定，也让主进程能读取私密变量（不必暴露到渲染层）。
function loadEnvFiles() {
  // 默认 development
  const mode = process.env.NODE_ENV || 'development';
  const root = process.cwd();
  const candidates = [
    `.env.${mode}.local`,
    `.env.${mode}`,
    mode === 'production' ? null : '.env.local',
    '.env'
  ].filter(Boolean);

  try {
    const dotenv = require('dotenv');
    for (const file of candidates) {
      const full = path.join(root, file);
      if (fs.existsSync(full)) {
        dotenv.config({ path: full });
      }
    }
  } catch (e) {
    // 如果未安装 dotenv，不中断应用。
    console.warn('[env] dotenv not loaded:', e.message);
  }
}
loadEnvFiles();
// --------------------------------------

const isMac = process.platform === 'darwin';

let mainWindow;
const globalEmitter = new EventEmitter();

function webContentsCreated(remote, emitter) {
  return (_event, contents) => {
    if (remote?.enable && typeof remote.enable === 'function') {
      try {
        remote.enable(contents);
      } catch (error) {
        console.warn('[remote] enable failed:', error.message);
      }
    }

    if (!contents || typeof contents.on !== 'function') {
      return;
    }

    const type = typeof contents.getType === 'function' ? contents.getType() : undefined;
    const shouldIntercept = type === 'window' || type === 'webview';
    if (!shouldIntercept) {
      return;
    }

    const resolveRecipientWindow = () => {
      const candidateSet = new Set();

      const hostContents = contents.hostWebContents || contents.getOpener?.();
      if (hostContents) {
        const ownerFromHost = BrowserWindow.fromWebContents(hostContents);
        if (ownerFromHost && !ownerFromHost.isDestroyed()) {
          candidateSet.add(ownerFromHost);
        }
      }

      const ownerFromSelf = BrowserWindow.fromWebContents(contents);
      if (ownerFromSelf && !ownerFromSelf.isDestroyed()) {
        candidateSet.add(ownerFromSelf);
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        candidateSet.add(mainWindow);
      }

      BrowserWindow.getAllWindows()
        .filter(win => win && !win.isDestroyed())
        .forEach(win => candidateSet.add(win));

      const [first] = candidateSet;
      return first ?? null;
    };

    const forwardToTab = ({ url, frameName, disposition, options }) => {
      if (!url) {
        return false;
      }

      const recipientWindow = resolveRecipientWindow();
      if (recipientWindow) {
        recipientWindow.webContents.send('open-url-in-tab', {
          url,
          frameName,
          disposition,
          options
        });
      }

      emitter?.emit?.('webview:new-window', {
        url,
        frameName,
        disposition,
        options,
        windowId: recipientWindow ? recipientWindow.id : null
      });

      return true;
    };

    const shouldHandleDisposition = disposition => {
      return (
        disposition === 'foreground-tab' ||
        disposition === 'background-tab' ||
        disposition === 'new-window' ||
        disposition === 'default'
      );
    };

    if (typeof contents.setWindowOpenHandler === 'function') {
      contents.setWindowOpenHandler(details => {
        if (!shouldHandleDisposition(details?.disposition)) {
          return { action: 'allow' };
        }

        const handled = forwardToTab({
          url: details?.url,
          frameName: details?.frameName,
          disposition: details?.disposition,
          options: details?.features
        });

        return handled ? { action: 'deny' } : { action: 'allow' };
      });
    } else {
      contents.on('new-window', (event, url, frameName, disposition, options) => {
        if (!shouldHandleDisposition(disposition) || !url) {
          return;
        }

        const handled = forwardToTab({ url, frameName, disposition, options });
        if (handled) {
          event.preventDefault();
        }
      });
    }
  };
}

app.on('web-contents-created', webContentsCreated(null, globalEmitter));

// 响应截屏请求
ipcMain.handle('capture-active-tab-screenshot', async (event, webContentsId) => {
  if (!webContentsId) {
    console.error('Screenshot request without webContentsId');
    return null;
  }

  const webviewContent = webContents.fromId(webContentsId);

  if (webviewContent) {
    try {
      const image = await webviewContent.capturePage();
      // const imageBuffer = image.toPNG();
      // // 确保 images 目录存在
      // const imagesDir = path.join(app.getAppPath(), 'images');
      // if (!fs.existsSync(imagesDir)) {
      //   fs.mkdirSync(imagesDir, { recursive: true });
      // }
      // // 生成文件名并保存
      // const fileName = `screenshot-${Date.now()}.png`;
      // const filePath = path.join(imagesDir, fileName);
      // fs.writeFileSync(filePath, imageBuffer);
      
      // console.log('Screenshot saved to:', filePath);
      // // 返回图片的 data URL，保持原接口兼容性
      return image.toDataURL();
    } catch (e) {
      console.error('Failed to capture or save page:', e);
      return null;
    }
  }
  return null;
});

// ---------------- Local Proxy for API (Production-friendly) ----------------
// 将渲染层对 /v1/* 的调用转发到后端，规避浏览器 CORS，隐藏真实 API Key。
let localProxyPort = null;
function startLocalProxy() {
  const http = require('http');
  const desiredPort = process.env.LOCAL_PROXY_PORT ? Number(process.env.LOCAL_PROXY_PORT) : 0; // 0 随机端口

  // 路由表：prefix -> target 后端。可按需新增。
  // stripPrefix: 是否在转发时裁剪掉前缀本身；keyEnv: 使用哪个环境变量作为 API Key。
  const routeTable = [
    {
      prefix: '/oneai',
      target: process.env.ONEAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://oneai.17usoft.com/v1',
      keyEnv: 'ONEAI_API_KEY',
      stripPrefix: true
    },
    {
      prefix: '/openai',
      target: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      keyEnv: 'OPENAI_API_KEY',
      stripPrefix: true
    },
    // 保留原来的 /v1 兼容（可作为默认）
    {
      prefix: '/v1/chat/completions',
      target: process.env.OPENAI_BASE_URL || 'https://oneai.17usoft.com',
      keyEnv: 'OPENAI_API_KEY',
      stripPrefix: false
    }
  ];

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      return res.end('Bad Request');
    }
    // 匹配路由前缀
    const matched = routeTable.find(r => req.url === r.prefix || req.url.startsWith(r.prefix + '/'));
    if (!matched) {
      // 未匹配也返回可读的 CORS 错误信息
      const origin = req.headers.origin || '*';
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-eko-model');
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: 'Not Found', detail: 'No route matched', url: req.url }));
    }

    // 处理 CORS 预检请求 (OPTIONS) - 不转发后端
    if (req.method === 'OPTIONS') {
      const origin = req.headers.origin || '*';
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-eko-model');
      res.setHeader('Access-Control-Max-Age', '600'); // 10 分钟缓存预检
      res.statusCode = 204; // No Content
      return res.end();
    }
    try {
      // 计算被转发的实际路径（去掉前缀）
      const relativePath = matched.stripPrefix ? req.url.slice(matched.prefix.length) || '/' : req.url;
      const targetBase = matched.target;
      // 聚合请求体
      let body = null;
      if (req.method && !['GET', 'HEAD'].includes(req.method)) {
        body = await new Promise((resolve, reject) => {
          const chunks = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', reject);
        });
      }

      const targetUrl = targetBase.replace(/\/$/, '') + relativePath; // 拼接目标 URL
      const keyEnv = matched.keyEnv;
      const apiKey = process.env[keyEnv] || process.env.OPENAI_API_KEY || process.env.ONEAI_API_KEY;
      const headers = {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      };
      // 透传可选模型信息
      if (req.headers['x-eko-model']) headers['x-eko-model'] = req.headers['x-eko-model'];

      const remoteRes = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: body ?? undefined
      });

      res.statusCode = remoteRes.status;
      const hopByHop = new Set(['connection','transfer-encoding','keep-alive','proxy-authenticate','proxy-authorization','te','trailers','upgrade']);
      const contentType = remoteRes.headers.get('content-type') || '';
      const isSSE = contentType.includes('text/event-stream');

      remoteRes.headers.forEach((value, key) => {
        if (!hopByHop.has(key.toLowerCase())) {
          // SSE 需要确保以下头部存在或被覆盖
          if (isSSE && key.toLowerCase() === 'content-type') {
            res.setHeader('Content-Type', 'text/event-stream');
          } else {
            res.setHeader(key, value);
          }
        }
      });

      // 统一添加 CORS 允许头（响应阶段）
      const origin = req.headers.origin || '*';
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      // 暂不开放凭证；如需 cookie 可改为 true 并配合后端
      // res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Type');

      if (isSSE) {
        // 追加 SSE 推荐头
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
      }

      // 如果没有 body（某些错误响应），读取文本后返回
      if (!remoteRes.body) {
        const fallbackText = await remoteRes.text().catch(() => '');
        res.end(fallbackText);
        return;
      }

      // Node18+ fetch 使用 Web Streams；逐块读取并写出
      const reader = remoteRes.body.getReader();
      // 将二进制流直接写出；SSE 后端会发送已经格式化好的 'data:' 行
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          // value 是 Uint8Array
          res.write(Buffer.from(value));
        }
      }
      res.end();
    } catch (err) {
      console.error('[LocalProxy] error:', err);
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'Bad Gateway', detail: String(err?.message || err) }));
    }
  });

  server.listen(desiredPort, '127.0.0.1', () => {
    localProxyPort = server.address().port;
    console.log('[LocalProxy] route table:');
    routeTable.forEach(r => {
      console.log(`  ${r.prefix} -> ${r.target} (stripPrefix=${r.stripPrefix}, keyEnv=${r.keyEnv})`);
    });
    console.log(`[LocalProxy] started on port ${localProxyPort}`);
  });

  return server;
}
// ---------------------------------------------------------------------------

function createApplicationMenu() {
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideothers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '新建窗口',
          accelerator: 'CmdOrCtrl+N',
          click: () => createMainWindow()
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              {
                label: '语音',
                submenu: [{ role: 'startspeaking' }, { role: 'stopspeaking' }]
              }
            ]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }])
      ]
    },
    {
      label: '查看',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'AI Native Browser Shell',
    backgroundColor: '#101014',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  window.once('ready-to-show', () => window.show());

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    window.loadURL(devServerUrl);
  } else {
    window.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    window.webContents.send('open-url-in-tab', url);
    return { action: 'deny' };
  });

  return window;
}

function registerIpcHandlers() {
  ipcMain.handle('window-control', (event, action) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }

    switch (action) {
      case 'toggle-devtools':
        if (targetWindow.webContents.isDevToolsOpened()) {
          targetWindow.webContents.closeDevTools();
        } else {
          targetWindow.webContents.openDevTools({ mode: 'detach' });
        }
        break;
      case 'focus':
        targetWindow.focus();
        break;
      default:
        break;
    }
  });

  ipcMain.handle('create-new-window', (_event, url) => {
    const childWindow = createMainWindow();
    childWindow.once('ready-to-show', () => {
      childWindow.webContents.send('open-url-in-tab', url);
    });
  });

  ipcMain.handle('app-info:get', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }));

  ipcMain.handle('openai:config', () => ({
    // 不直接暴露真实 API Key 到渲染层；用 *** 表示存在。
    apiKey: process.env.OPENAI_API_KEY ? '***' : null,
    // 如果本地代理已经启动，返回代理地址，否则 fallback 真实地址（可能触发 CORS）。
    baseUrl: localProxyPort ? `http://127.0.0.1:${localProxyPort}/v1` : (process.env.OPENAI_BASE_URL ?? null)
  }));
}

app.whenReady().then(() => {
  createApplicationMenu();
  mainWindow = createMainWindow();
  registerIpcHandlers();
  startLocalProxy();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});
