import { describe, expect, it } from 'vitest';

import {
  ClaudeFormat,
  GeminiFormat,
  OpenAIResponsesFormat,
  decodeResponseFromFormat,
} from '../src/index.js';
import type { LLMRequest } from '../src/index.js';

describe('format adapters', () => {
  it('GeminiFormat: thoughtSignatures.gemini -> thoughtSignature', () => {
    const fmt = new GeminiFormat();
    const request: LLMRequest = {
      contents: [{
        role: 'model',
        parts: [{ text: 'thinking', thought: true, thoughtSignatures: { gemini: 'sig_gem_1' } }],
      }],
    };

    const body = fmt.encodeRequest(request) as any;
    expect(body.contents[0].parts[0].thoughtSignature).toBe('sig_gem_1');
    expect(body.contents[0].parts[0].thoughtSignatures).toBeUndefined();
  });

  it('ClaudeFormat: thinking block 的 signature 字段正确传递', () => {
    const fmt = new ClaudeFormat('claude-sonnet-4');
    const request: LLMRequest = {
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'deep thought', thought: true, thoughtSignatures: { claude: 'sig_claude_1' } }] },
      ],
    };

    const body = fmt.encodeRequest(request) as any;
    const thinking = body.messages[1].content.find((block: any) => block.type === 'thinking');
    expect(thinking.signature).toBe('sig_claude_1');
    expect(thinking.thinking).toBe('deep thought');
  });

  it('OpenAIResponsesFormat: reasoning item 会回传 encrypted_content', () => {
    const fmt = new OpenAIResponsesFormat('o3');
    const request: LLMRequest = {
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'deep thought', thought: true, thoughtSignatures: { 'openai-responses': 'enc_sig_1' } }] },
      ],
    };

    const body = fmt.encodeRequest(request) as any;
    const reasoning = body.input.find((item: any) => item.type === 'reasoning');
    expect(reasoning.encrypted_content).toBe('enc_sig_1');
  });

  it('decodeResponseFromFormat 默认返回自动拼接前缀的字符串签名', () => {
    const response = decodeResponseFromFormat({
      content: [
        { type: 'thinking', thinking: 'let me think', signature: 'sig_dec_1' },
        { type: 'text', text: 'done' },
      ],
      stop_reason: 'end_turn',
    }, { format: 'claude', model: 'claude-sonnet-4' });

    const thought = response.content.parts[0] as any;
    expect(thought.thoughtSignature).toBe('claude:sig_dec_1');
    expect(thought.thoughtSignatures).toBeUndefined();
  });
});
