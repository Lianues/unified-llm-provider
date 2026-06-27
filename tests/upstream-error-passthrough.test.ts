import { describe, expect, it, vi } from 'vitest';

import {
  createClaudeProvider,
  createOpenAICompatibleProvider,
  decodeResponseFromFormat,
} from '../src/index.js';
import type { LLMRequest } from '../src/index.js';

const request: LLMRequest = {
  contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
};

describe('upstream error passthrough', () => {
  it('不会把 OpenAI Responses 的 error:null 成功响应误判为错误', () => {
    const response = decodeResponseFromFormat({
      id: 'resp_123',
      status: 'completed',
      error: null,
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'done' }] },
      ],
    }, { format: 'openai-responses', model: 'gpt-test' }) as any;

    expect(response.error).toBeUndefined();
    expect(response.content.parts).toEqual([{ text: 'done' }]);
  });

  it('非流式 HTTP 错误不再抛出，统一输出里透传 status / headers / 原始响应体', async () => {
    const rawError = { error: { type: 'invalid_request_error', message: 'bad request' } };
    const mockFetch = vi.fn(async () => new Response(JSON.stringify(rawError), {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_123' },
    }));

    const provider = createOpenAICompatibleProvider({
      provider: 'openai-compatible',
      model: 'gpt-test',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.test/v1',
      fetch: mockFetch as any,
    });

    const response = await provider.chat(request, {
      inputFormat: 'unified',
      outputFormat: 'unified',
    }) as any;

    expect(response.error).toMatchObject({
      kind: 'http_error',
      status: 400,
      statusText: 'Bad Request',
      rawBody: rawError,
    });
    expect(response.error.headers['x-request-id']).toBe('req_123');
    expect(response.error.bodyText).toBe(JSON.stringify(rawError));
    expect(response.rawResponse).toEqual(rawError);
    expect(response.content.parts).toEqual([{ text: '' }]);
  });

  it('非 unified 输出遇到 HTTP 错误时直接返回上游原始响应体', async () => {
    const rawError = { error: { message: 'rate limited', code: 'rate_limit_exceeded' } };
    const mockFetch = vi.fn(async () => new Response(JSON.stringify(rawError), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }));

    const provider = createOpenAICompatibleProvider({
      provider: 'openai-compatible',
      model: 'gpt-test',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.test/v1',
      fetch: mockFetch as any,
    });

    const response = await provider.chat(request, {
      inputFormat: 'unified',
      outputFormat: 'openai-compatible',
    });

    expect(response).toEqual(rawError);
  });

  it('流式 HTTP 错误产出一个 error chunk，并透传原始响应体', async () => {
    const rawError = { error: { message: 'too many requests' } };
    const mockFetch = vi.fn(async () => new Response(JSON.stringify(rawError), {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'Content-Type': 'application/json' },
    }));

    const provider = createOpenAICompatibleProvider({
      provider: 'openai-compatible',
      model: 'gpt-test',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.test/v1',
      fetch: mockFetch as any,
    });

    const chunks: any[] = [];
    for await (const chunk of provider.chatStream(request, {
      inputFormat: 'unified',
      outputFormat: 'unified',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].error).toMatchObject({
      kind: 'http_error',
      status: 429,
      statusText: 'Too Many Requests',
      rawBody: rawError,
    });
    expect(chunks[0].rawChunk).toEqual(rawError);
  });

  it('200 OK 的 SSE 错误块不再静默吞掉，而是原生透传给前端', async () => {
    const rawError = { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } };
    const mockFetch = vi.fn(async () => new Response(
      `event: error\ndata: ${JSON.stringify(rawError)}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));

    const provider = createClaudeProvider({
      provider: 'claude',
      model: 'claude-sonnet-4',
      apiKey: 'sk-test',
      baseUrl: 'https://api.anthropic.test/v1',
      fetch: mockFetch as any,
    });

    const chunks: any[] = [];
    for await (const chunk of provider.chatStream(request, {
      inputFormat: 'unified',
      outputFormat: 'unified',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].error).toMatchObject({
      kind: 'stream_error',
      event: 'error',
      rawChunk: { ...rawError, event: 'error' },
    });
    expect(chunks[0].rawChunk).toEqual({ ...rawError, event: 'error' });
  });

  it('SSE data 不是 JSON 时返回 stream_parse_error，保留 data 原文', async () => {
    const mockFetch = vi.fn(async () => new Response(
      'data: upstream plain text error\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));

    const provider = createOpenAICompatibleProvider({
      provider: 'openai-compatible',
      model: 'gpt-test',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.test/v1',
      fetch: mockFetch as any,
    });

    const chunks: any[] = [];
    for await (const chunk of provider.chatStream(request, {
      inputFormat: 'unified',
      outputFormat: 'unified',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].error).toMatchObject({
      kind: 'stream_parse_error',
      data: 'upstream plain text error',
      bodyText: 'upstream plain text error',
    });
    expect(chunks[0].rawChunk).toBe('upstream plain text error');
  });

  it('非 unified 流式输出遇到错误块时直接返回上游原始 chunk', async () => {
    const rawError = { error: { message: 'bad upstream chunk' } };
    const mockFetch = vi.fn(async () => new Response(
      `data: ${JSON.stringify(rawError)}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));

    const provider = createOpenAICompatibleProvider({
      provider: 'openai-compatible',
      model: 'gpt-test',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.test/v1',
      fetch: mockFetch as any,
    });

    const chunks: any[] = [];
    for await (const chunk of provider.chatStream(request, {
      inputFormat: 'unified',
      outputFormat: 'openai-compatible',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([rawError]);
  });
});
