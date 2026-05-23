import { describe, expect, it } from 'vitest';

import {
  convertRequest,
  convertResponse,
  createStreamConverter,
} from '../src/index.js';

describe('format bridge', () => {
  it('可把 unified request 转成 Claude request，签名随请求体格式一起落位', () => {
    const raw = convertRequest({
      contents: [
        { role: 'user', parts: [{ text: 'hello' }] },
        { role: 'model', parts: [{ text: 'deep thought', thought: true, thoughtSignature: 'claude:sig_req_1' }] },
      ],
    }, {
      from: 'unified',
      to: 'claude',
      model: 'claude-sonnet-4',
    }) as any;

    const thinking = raw.messages[1].content.find((block: any) => block.type === 'thinking');
    expect(thinking.signature).toBe('sig_req_1');
    expect(thinking.thinking).toBe('deep thought');
  });

  it('可把 Claude response 转回 unified，自动补 thoughtSignature 前缀', () => {
    const raw = convertResponse({
      content: [
        { type: 'thinking', thinking: 'let me think', signature: 'sig_resp_1' },
        { type: 'text', text: 'done' },
      ],
      stop_reason: 'end_turn',
    }, {
      from: 'claude',
      to: 'unified',
      model: 'claude-sonnet-4',
    }) as any;

    expect(raw.content.parts[0].thoughtSignature).toBe('claude:sig_resp_1');
    expect(raw.content.parts[0].thoughtSignatures).toBeUndefined();
  });

  it('可把 OpenAI Responses request 转成 unified request，并保留 openai 签名', () => {
    const raw = convertRequest({
      model: 'o3',
      input: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking...' }], encrypted_content: 'enc_sig_1' },
        { role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      ],
    }, {
      from: 'openai-responses',
      to: 'unified',
      model: 'o3',
    }) as any;

    expect(raw.contents[0].parts[0].thoughtSignature).toBe('openai-responses:enc_sig_1');
  });

  it('stream converter 可把 Claude chunk 转成 unified chunk', () => {
    const converter = createStreamConverter({ from: 'claude', to: 'unified', model: 'claude-sonnet-4' });
    const chunk = converter.convert({
      type: 'content_block_delta',
      delta: { type: 'signature_delta', signature: 'sig_stream_1' },
    }) as any;

    expect(chunk.thoughtSignature).toBe('claude:sig_stream_1');
  });
});
