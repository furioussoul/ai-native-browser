export type LanguageModelV2FinishReason = 'stop' | 'length' | 'tool' | 'error' | 'other';

export interface WorkflowStep {
  id: string;
  title: string;
  description?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  steps?: WorkflowStep[];
}

export interface WorkflowAgent {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
}

export interface ToolResult {
  summary?: string;
  data?: Record<string, unknown>;
  outputText?: string;
}

export type StreamCallbackMessage = {
  taskId: string;
  agentName: string;
  nodeId?: string | null;
} & (
  | {
      type: 'workflow';
      streamDone: boolean;
      workflow: Workflow;
    }
  | {
      type: 'agent_start';
      agentNode: WorkflowAgent;
    }
  | {
      type: 'text' | 'thinking';
      streamId: string;
      streamDone: boolean;
      text: string;
    }
  | {
      type: 'file';
      mimeType: string;
      data: string;
    }
  | {
      type: 'tool_streaming';
      toolName: string;
      toolId: string;
      paramsText: string;
    }
  | {
      type: 'tool_use';
      toolName: string;
      toolId: string;
      params: Record<string, unknown>;
    }
  | {
      type: 'tool_running';
      toolName: string;
      toolId: string;
      text: string;
      streamId: string;
      streamDone: boolean;
    }
  | {
      type: 'tool_result';
      toolName: string;
      toolId: string;
      params: Record<string, unknown>;
      toolResult: ToolResult;
    }
  | {
      type: 'agent_result';
      agentNode: WorkflowAgent;
      error?: unknown;
      result?: string;
    }
  | {
      type: 'error';
      error: unknown;
    }
  | {
      type: 'finish';
      finishReason: LanguageModelV2FinishReason;
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    }
);
