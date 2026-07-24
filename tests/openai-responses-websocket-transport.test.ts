import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { streamOpenAIResponsesWebSocket } from '../src/llm/websocket-openai-responses.js';
import type { FormatAdapter } from '../src/llm/formats/types.js';

const passthroughFormat: FormatAdapter = {
  encodeRequest: () => ({ input: [] }),
  decodeResponse: () => ({ content: { role: 'model', parts: [] } }),
  decodeStreamChunk: (raw) => {
    const record = raw as { delta?: unknown };
    return typeof record.delta === 'string' ? { textDelta: record.delta } : {};
  },
  createStreamState: () => ({}),
};

describe('OpenAI Responses WebSocket ws transport', () => {
  it('consumes a burst of delta events and the terminal event without per-message pacing', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, perMessageDeflate: true });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('WebSocket test server did not expose a TCP port');

    let negotiatedExtensions: string | undefined;
    server.once('connection', (socket) => {
      negotiatedExtensions = socket.extensions;
      socket.once('message', () => {
        for (let index = 0; index < 50; index += 1) {
          socket.send(JSON.stringify({
            type: 'response.output_text.delta',
            response_id: 'resp_burst',
            item_id: 'msg_burst',
            output_index: 0,
            content_index: 0,
            sequence_number: index,
            delta: String(index % 10),
          }));
        }
        socket.send(JSON.stringify({
          type: 'response.completed',
          response: { id: 'resp_burst', output: [] },
        }), () => socket.close());
      });
    });

    const startedAt = performance.now();
    let text = '';
    try {
      for await (const chunk of streamOpenAIResponsesWebSocket({
        endpoint: {
          url: `http://127.0.0.1:${address.port}`,
          webSocketUrl: `ws://127.0.0.1:${address.port}`,
          webSocketSessionKey: `transport-test-${Date.now()}-${Math.random()}`,
          headers: {},
        },
        url: `http://127.0.0.1:${address.port}`,
        headers: {},
        body: { input: [] },
        format: passthroughFormat,
      })) {
        text += chunk.textDelta ?? '';
      }
    } finally {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }

    expect(text).toBe('0123456789'.repeat(5));
    expect(negotiatedExtensions).toBe('');
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
