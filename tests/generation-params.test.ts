import { describe, expect, it } from 'vitest';

import {
  createClaudeProvider,
  createGeminiProvider,
  createOpenAICompatibleProvider,
  createOpenAIResponsesProvider,
} from '../src/index.js';
import type { LLMRequest } from '../src/index.js';

const request: LLMRequest = {
  contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
  generationConfig: {
    temperature: 0.1,
    topP: 0.2,
    topK: 16,
    maxOutputTokens: 128,
  },
};

describe('unified generation params', () => {
  it('OpenAI compatible 映射 temperature/topP/maxOutputTokens，topK 默认不映射，requestBody 覆盖统一参数', async () => {
    const provider = createOpenAICompatibleProvider({
      provider: 'openai-compatible',
      model: 'gpt-test',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.test/v1',
      requestBody: {
        temperature: 0.9,
        top_p: 0.8,
        max_tokens: 512,
        custom_flag: true,
      },
    });

    const dry = await provider.dryRun(request, { stream: false });
    const body = dry.body as any;

    expect(body).toMatchObject({
      temperature: 0.9,
      top_p: 0.8,
      max_tokens: 512,
      custom_flag: true,
    });
    expect(body.top_k).toBeUndefined();
  });

  it('OpenAI Responses 映射 temperature/topP/maxOutputTokens，requestBody 可覆盖 max_output_tokens', async () => {
    const provider = createOpenAIResponsesProvider({
      provider: 'openai-responses',
      model: 'gpt-test',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.test/v1',
      requestBody: {
        max_output_tokens: 256,
      },
    });

    const dry = await provider.dryRun(request, { stream: false });
    const body = dry.body as any;

    expect(body.temperature).toBe(0.1);
    expect(body.top_p).toBe(0.2);
    expect(body.max_output_tokens).toBe(256);
    expect(body.top_k).toBeUndefined();
  });

  it('Claude 映射 temperature/topP/topK/maxOutputTokens，静态 requestBody 覆盖统一参数，运行时 patch 再覆盖静态 requestBody', async () => {
    const provider = createClaudeProvider({
      provider: 'claude',
      model: 'claude-test',
      apiKey: 'sk-test',
      baseUrl: 'https://api.anthropic.test/v1',
      requestBody: {
        temperature: 0.5,
        top_p: 0.6,
        top_k: 32,
        max_tokens: 1024,
      },
    });

    provider.patchRequestBodyOverrides({
      temperature: 0.7,
      top_p: 0.75,
    });

    const dry = await provider.dryRun(request, { stream: false });
    const body = dry.body as any;

    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.75);
    expect(body.top_k).toBe(32);
    expect(body.max_tokens).toBe(1024);
  });

  it('Gemini 保持 generationConfig 的 Gemini 风格字段，requestBody.generationConfig 深合并并覆盖统一参数', async () => {
    const provider = createGeminiProvider({
      provider: 'gemini',
      model: 'gemini-test',
      apiKey: 'gemini-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      requestBody: {
        generationConfig: {
          temperature: 0.3,
          topP: 0.4,
          topK: 24,
          maxOutputTokens: 256,
        },
      },
    });

    const dry = await provider.dryRun(request, { stream: false });
    const body = dry.body as any;

    expect(body.generationConfig).toMatchObject({
      temperature: 0.3,
      topP: 0.4,
      topK: 24,
      maxOutputTokens: 256,
    });
  });
});
