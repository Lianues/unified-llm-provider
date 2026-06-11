/**
 * LLM 请求 / 响应类型定义
 *
 * 内部统一使用 Gemini 格式。各 LLM Provider 负责与自身 API 格式互转。
 */

import { Content, Part, UsageMetadata, FunctionCallPart } from './message.js';
import { FunctionDeclaration } from './tool.js';

export interface LLMThinkingConfig {
  /** 是否要求 Gemini 返回 thought parts。仅 Gemini 原生生效；其它 provider 会忽略该统一字段。 */
  includeThoughts?: boolean;
  /** 思考预算 token。Gemini 原生透传；Claude 映射为 thinking.budget_tokens；OpenAI 系默认忽略。 */
  thinkingBudget?: number;
  /** 思考强度等级。当前 Gemini 原生透传；Claude/OpenAI 系默认忽略。 */
  thinkingLevel?: string;
  [key: string]: unknown;
}

/** 统一生成参数（允许 provider 扩展字段） */
export interface LLMGenerationConfig {
  /** 控制随机性。映射到 OpenAI/Claude temperature、Gemini generationConfig.temperature。 */
  temperature?: number;
  /** nucleus sampling。统一使用 Gemini 风格 topP，映射到 OpenAI/Claude top_p。 */
  topP?: number;
  /** token 候选采样数。Gemini 原生 topK，Claude 映射到 top_k；OpenAI 系默认不映射。 */
  topK?: number;
  /** 最大输出 token。映射到 OpenAI Chat/Claude max_tokens、OpenAI Responses max_output_tokens。 */
  maxOutputTokens?: number;
  stopSequences?: string[];
  /**
   * 统一思考配置。
   * 规则：传入 thinkingBudget 或 thinkingLevel 时，Gemini 会自动视为 includeThoughts=true；
   * Claude 只映射 thinkingBudget；OpenAI 系默认忽略整个 thinkingConfig。
   */
  thinkingConfig?: LLMThinkingConfig;
  /**
   * 允许暂存后续统一字段或 provider 扩展字段；真正无损透传请优先使用 LLMConfig.requestBody。
   */
  [key: string]: unknown;
}

/** LLM 请求体（Gemini generateContent 格式） */
export interface LLMRequest {
  contents: Content[];
  tools?: {
    functionDeclarations: FunctionDeclaration[];
  }[];
  systemInstruction?: {
    parts: Part[];
  };
  generationConfig?: LLMGenerationConfig;
}

/** LLM 响应（统一格式） */
export interface LLMResponse {
  /** 模型返回的消息内容 */
  content: Content;
  /** 结束原因 */
  finishReason?: string;
  /** Token 用量统计 */
  usageMetadata?: UsageMetadata;
}

/** 流式响应的单个数据块 */
export interface LLMStreamChunk {
  /** 本块新增的有序 parts（优先使用） */
  partsDelta?: Part[];
  /** 本块新增的文本 */
  textDelta?: string;
  /** 完整的函数调用（通常在最后一块或专用块中出现） */
  functionCalls?: FunctionCallPart[];
  /** 结束原因（最后一块） */
  finishReason?: string;
  /** Token 用量（最后一块） */
  usageMetadata?: UsageMetadata;
  /** 便于用户直接存取的单字符串签名形式，如 gemini:abc / claude:def */
  thoughtSignature?: string;
  /** 不同渠道格式的思考签名 */
  thoughtSignatures?: {
    gemini?: string;
    claude?: string;
    'openai-compatible'?: string;
    'openai-responses'?: string;
    [key: string]: string | undefined;
  };
}
