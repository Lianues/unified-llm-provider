import { describe, expect, it, vi } from 'vitest';

import { listAvailableModels } from '../src/index.js';

describe('model catalog', () => {
  it('deepseek 在无 apiKey 时返回内置模型列表', async () => {
    const fetchMock = vi.fn();
    const result = await listAvailableModels({
      provider: 'deepseek',
      apiKey: '',
      baseUrl: 'https://api.deepseek.com/v1',
      fetch: fetchMock as any,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.models.map(model => model.id)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
  });

  it('openai-compatible 会请求 /models 并解析列表', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 'gpt-4o', owned_by: 'openai' },
        { id: 'gpt-4.1', owned_by: 'openai' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await listAvailableModels({
      provider: 'openai-compatible',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      fetch: fetchMock as any,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.models.map(model => model.id)).toEqual(['gpt-4.1', 'gpt-4o']);
  });
});
