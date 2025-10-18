import type { StreamCallbackMessage, Workflow, WorkflowAgent, ToolResult } from '../types/agent';

export interface MockAgentOptions {
  prompt: string;
  currentUrl: string;
  taskId: string;
  agentName: string;
  onMessage: (message: StreamCallbackMessage) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

interface ScheduledMessage {
  delay: number;
  factory: () => StreamCallbackMessage;
}

const baseAgent: WorkflowAgent = {
  id: 'agent-001',
  name: 'AI Navigator',
  description: '帮助你理解当前页面并给出建议的智能助手'
};

const researchWorkflow: Workflow = {
  id: 'workflow-001',
  name: '页面分析流程',
  description: '对当前网页内容进行理解、检索并生成总结',
  steps: [
    { id: 'step-1', title: '解析页面结构' },
    { id: 'step-2', title: '检索相关资料' },
    { id: 'step-3', title: '综合总结与建议' }
  ]
};

const toolResult: ToolResult = {
  summary: '检索到 3 条与主题相关的链接',
  data: {
    links: [
      'https://developer.mozilla.org/',
      'https://react.dev/',
      'https://tailwindcss.com/'
    ]
  }
};

export function mockAgentSSE({
  prompt,
  currentUrl,
  taskId,
  agentName,
  onMessage,
  onComplete,
  onError
}: MockAgentOptions): () => void {
  let cancelled = false;
  const timeouts: ReturnType<typeof setTimeout>[] = [];

  const schedule = (message: StreamCallbackMessage, delay: number) => {
    const timeout = setTimeout(() => {
      if (cancelled) {
        return;
      }

      try {
        onMessage(message);
      } catch (error) {
        cancelled = true;
        timeouts.forEach(clearTimeout);
        onError?.(error instanceof Error ? error : new Error('未知错误'));
        return;
      }

      if (message.type === 'finish') {
        onComplete?.();
      }
    }, delay);

    timeouts.push(timeout);
  };

  const createId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

  const streamId = createId('stream');

  const messages: ScheduledMessage[] = [
    {
      delay: 200,
      factory: () => ({
        taskId,
        agentName,
        type: 'agent_start',
        agentNode: baseAgent
      })
    },
    {
      delay: 600,
      factory: () => ({
        taskId,
        agentName,
        type: 'workflow',
        streamDone: false,
        workflow: researchWorkflow
      })
    },
    {
      delay: 1200,
      factory: () => ({
        taskId,
        agentName,
        type: 'thinking',
        streamId,
        streamDone: false,
        text: `正在理解页面：${currentUrl}`
      })
    },
    {
      delay: 2000,
      factory: () => ({
        taskId,
        agentName,
        type: 'tool_streaming',
        toolName: '网页内容提取器',
        toolId: 'tool-parse-html',
        paramsText: JSON.stringify({ url: currentUrl }, null, 2)
      })
    },
    {
      delay: 2600,
      factory: () => ({
        taskId,
        agentName,
        type: 'tool_running',
        toolName: '网页内容提取器',
        toolId: 'tool-parse-html',
        text: '正在提取页面摘要…',
        streamId,
        streamDone: false
      })
    },
    {
      delay: 3200,
      factory: () => ({
        taskId,
        agentName,
        type: 'tool_use',
        toolName: '网页内容提取器',
        toolId: 'tool-parse-html',
        params: { url: currentUrl, maxTokens: 512 }
      })
    },
    {
      delay: 3800,
      factory: () => ({
        taskId,
        agentName,
        type: 'tool_result',
        toolName: '网页内容提取器',
        toolId: 'tool-parse-html',
        params: { url: currentUrl },
        toolResult
      })
    },
    {
      delay: 4500,
      factory: () => ({
        taskId,
        agentName,
        type: 'text',
        streamId,
        streamDone: false,
        text: `针对你的问题「${prompt}」，我将结合当前页面内容给出总结。`
      })
    },
    {
      delay: 5200,
      factory: () => ({
        taskId,
        agentName,
        type: 'text',
        streamId,
        streamDone: true,
        text: '总结：页面主要介绍了 Electron + React + Tailwind 的浏览器壳结构，并提供了可扩展的 AI 面板。'
      })
    },
    {
      delay: 5800,
      factory: () => ({
        taskId,
        agentName,
        type: 'agent_result',
        agentNode: baseAgent,
        result: '完成初步回答，如需进一步指令请告知。'
      })
    },
    {
      delay: 6400,
      factory: () => ({
        taskId,
        agentName,
        type: 'finish',
        finishReason: 'stop',
        usage: {
          promptTokens: 128,
          completionTokens: 256,
          totalTokens: 384
        }
      })
    }
  ];

  messages.forEach(({ delay, factory }) => {
    schedule(factory(), delay);
  });

  return () => {
    cancelled = true;
    timeouts.forEach(clearTimeout);
    onComplete?.();
  };
}
