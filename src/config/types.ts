export type FetchLike = typeof fetch;

export interface LLMRequestDebugEvent {
  url: string;
  stream: boolean;
  headers: Record<string, string>;
  body: unknown;
}

export interface LLMResponseDebugEvent {
  url: string;
  stream: boolean;
  status?: number;
  headers?: Record<string, string>;
  bodyText?: string;
  error?: string;
}

export interface LLMStreamChunkDebugEvent {
  url: string;
  /** 本块原始文本 chunk */
  chunk: string;
  /** 当前累计已接收的完整文本 */
  accumulated: string;
}

export interface LLMDebugHooks {
  onRequest?(event: LLMRequestDebugEvent): void | Promise<void>;
  onResponse?(event: LLMResponseDebugEvent): void | Promise<void>;
  /** 流式响应每个 SSE chunk 的实时回调 */
  onStreamChunk?(event: LLMStreamChunkDebugEvent): void | Promise<void>;
}

export interface LLMEndpointOverride {
  url?: string;
  streamUrl?: string;
  headers?: Record<string, string>;
}

export interface LLMConfig {
  provider: string;
  /** 默认使用哪个 wire format；未填则由 provider 自身决定 */
  format?: string;
  apiKey?: string;
  /** 提供商真实模型 id */
  model: string;
  /** 默认 baseUrl。若 endpoint.url 已给定，则可不依赖 baseUrl */
  baseUrl?: string;
  /** 直接覆盖最终 endpoint（优先级高于 provider 默认拼接规则） */
  endpoint?: LLMEndpointOverride;
  /** 模型上下文窗口大小（token 数） */
  contextWindow?: number;
  /** 显式声明当前模型是否支持图片输入 */
  supportsVision?: boolean;
  /** 自定义请求头，会覆盖 provider 内置同名 header */
  headers?: Record<string, string>;
  /** 预留给上层 UI 或客户端的思考控制标记 */
  thinkingControl?: boolean;
  /** 自定义请求体，会深合并到 provider 编码后的最终请求体 */
  requestBody?: Record<string, unknown>;
  /** [Claude] 手动 Prompt Caching */
  promptCaching?: boolean;
  /** [Claude] 顶层自动缓存 */
  autoCaching?: boolean;
  /** 非流式请求超时（毫秒） */
  timeoutMs?: number;
  /** 流式请求超时（毫秒） */
  streamTimeoutMs?: number;
  /** 自定义 fetch 实现 */
  fetch?: FetchLike;
  /** 调试钩子 */
  debug?: LLMDebugHooks;
  /** 友好名称，可选 */
  name?: string;
  [key: string]: unknown;
}

export interface LLMModelDef extends LLMConfig {
  modelName: string;
}

export interface LLMRegistryConfig {
  defaultModelName: string;
  models: LLMModelDef[];
}
