import { Eko, LLMs, StreamCallbackMessage as EkoStreamMessage } from '@eko-ai/eko';
// 使用自定义扩展后的 BrowserAgent，支持跨站导航。
import ExtendedBrowserAgent from '../agent/ExtendedBrowserAgent';

export interface RealAgentOptions {
    prompt: string;
    currentUrl: string;
    taskId: string;
    agentName: string;
    openApiConfig: any;
    onMessage: (message: EkoStreamMessage) => void;
    onComplete?: () => void;
    onError?: (error: Error) => void;
    /** 自定义模型名称，默认 gpt-5 */
    modelName?: string;
}

/**
 * 创建真实的 Agent 运行（与 mockAgentSSE 类似的接口），返回一个取消函数。
 * 将 SDK streaming 回调适配为内部统一的消息格式。
 */
export function realAgentRun(options: RealAgentOptions): () => void {
    const { prompt, currentUrl, taskId, agentName, openApiConfig, onMessage, onComplete, onError, modelName } = options;

    const openaiBaseURL = openApiConfig['baseUrl'];
    const openaiApiKey = openApiConfig['apiKey'];

    if (!openaiApiKey) {
        onError?.(new Error('缺少 OPENAI_API_KEY'));
        return () => void 0;
    }

    const llms: LLMs = {
        default: {
            provider: 'openai-compatible',
            model: modelName || 'gpt-4o',
            apiKey: openaiApiKey,
            config: {
                baseURL: openaiBaseURL,
                // max_completion_tokens: 102400,
                temperature: 1.0
            }
        }
    };

    const abortController = new AbortController();

    const callback = {
        onMessage: async (msg: EkoStreamMessage) => {
            // 某些消息类型没有 streamDone 字段，做可选链并断言
            // const anyMsg: any = msg as any;
            // if (anyMsg?.streamDone === false || msg.type === 'tool_streaming') {
            //     return; // 仍在流式中，等待完成再输出
            // }
            console.log('Agent Message:', msg);
            onMessage(msg);
        }
    };

    // 初始化 Agent（BrowserAgent 可以感知当前页面上下文）
    // 使用扩展版本，允许 navigate_to 触发主界面 webview 跨站加载。
    const agents = [new ExtendedBrowserAgent()];
    const eko = new Eko({ llms, agents, callback });

    // 构造带上下文的提示词
    const fullPrompt = `当前页面 URL: ${currentUrl}\n请结合页面上下文执行以下用户指令：\n${prompt}`;

    eko.run(fullPrompt)
        .then((res: any) => {
            if (!res?.success) {
                onError?.(new Error(res?.result || '执行失败'));
            }
        }).catch(err => {
            onError?.(err instanceof Error ? err : new Error(String(err)));
        });

    // 返回取消函数
    return () => {
        abortController.abort();
        onComplete?.();
    };
}

export default realAgentRun;

