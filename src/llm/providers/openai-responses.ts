/**
 * OpenAI Responses Provider
 */

import { DEFAULTS } from '../../config/llm.js';
import type { LLMConfig } from '../../config/types.js';
import { OpenAIResponsesFormat } from '../formats/openai-responses.js';
import { LLMProvider } from './base.js';

export function createOpenAIResponsesProvider(config: LLMConfig): LLMProvider {
  const defaults = DEFAULTS['openai-responses'];
  const model = config.model || String(defaults.model ?? 'gpt-4o');
  const baseUrl = (config.baseUrl || defaults.baseUrl || '').replace(/\/+$/, '');

  return new LLMProvider(
    new OpenAIResponsesFormat(model),
    {
      url: config.endpoint?.url || `${baseUrl}/responses`,
      streamUrl: config.endpoint?.streamUrl,
      compactUrl: config.endpoint?.compactUrl || `${baseUrl}/responses/compact`,
      headers: {
        Authorization: `Bearer ${config.apiKey ?? ''}`,
        ...config.headers,
        ...config.endpoint?.headers,
      },
      fetch: config.fetch,
      debug: config.debug,
      proxy: config.endpoint?.proxy ?? config.proxy,
      timeoutMs: config.timeoutMs,
      streamTimeoutMs: config.streamTimeoutMs,
    },
    config.name ?? `OpenAIResponses(${model})`,
    config.requestBody,
    'openai-responses',
  );
}
