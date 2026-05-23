/**
 * HTTP 请求模块
 *
 * 通用的 HTTP 发送逻辑，不含任何格式转换。
 * 支持流式和非流式请求，通过 streamUrl 字段区分 URL。
 */

import type { FetchLike, LLMDebugHooks } from '../config/types.js';

export interface EndpointConfig {
  /** 非流式请求 URL */
  url: string;
  /** 流式请求 URL（与非流式不同时使用，如 Gemini），默认同 url */
  streamUrl?: string;
  /** 请求头（不含 Content-Type，内部自动加） */
  headers: Record<string, string>;
  /** 自定义 fetch 实现 */
  fetch?: FetchLike;
  /** 调试钩子 */
  debug?: LLMDebugHooks;
  /** 非流式默认超时（毫秒） */
  timeoutMs?: number;
  /** 流式默认超时（毫秒） */
  streamTimeoutMs?: number;
  /** 自定义 User-Agent */
  userAgent?: string;
}

/** 非流式请求默认超时（毫秒） */
const DEFAULT_TIMEOUT = 60_000;
/** 流式请求默认超时（毫秒） */
const DEFAULT_STREAM_TIMEOUT = 600_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

async function callDebugHookSafely<T>(hook: ((event: T) => void | Promise<void>) | undefined, event: T): Promise<void> {
  if (!hook) return;
  try {
    await hook(event);
  } catch {
    // 调试钩子不应影响主流程
  }
}

function combineSignals(externalSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!externalSignal) return timeoutSignal;

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([externalSignal, timeoutSignal]);
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort(externalSignal.reason);
  const onTimeout = () => controller.abort(timeoutSignal.reason);

  if (externalSignal.aborted) {
    controller.abort(externalSignal.reason);
    return controller.signal;
  }
  if (timeoutSignal.aborted) {
    controller.abort(timeoutSignal.reason);
    return controller.signal;
  }

  externalSignal.addEventListener('abort', onAbort, { once: true });
  timeoutSignal.addEventListener('abort', onTimeout, { once: true });
  controller.signal.addEventListener('abort', () => {
    externalSignal.removeEventListener('abort', onAbort);
    timeoutSignal.removeEventListener('abort', onTimeout);
  }, { once: true });

  return controller.signal;
}

export async function sendRequest(
  endpoint: EndpointConfig,
  body: unknown,
  stream: boolean,
  timeout?: number,
  signal?: AbortSignal,
  _loggingDir?: string,
): Promise<Response> {
  const url = stream ? (endpoint.streamUrl ?? endpoint.url) : endpoint.url;
  const effectiveTimeout = timeout ?? (stream ? (endpoint.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT) : (endpoint.timeoutMs ?? DEFAULT_TIMEOUT));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': endpoint.userAgent ?? 'unified-llm-interface',
    ...endpoint.headers,
  };

  await callDebugHookSafely(endpoint.debug?.onRequest, {
    url,
    stream,
    headers,
    body,
  });

  const fetchImpl = endpoint.fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: combineSignals(signal, effectiveTimeout),
    });
  } catch (err) {
    await callDebugHookSafely(endpoint.debug?.onResponse, {
      url,
      stream,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    throw err;
  }

  if (stream) {
    return wrapStreamForDebug(res, url, endpoint.debug);
  }

  void res.clone().text().then(
    async (text) => {
      await callDebugHookSafely(endpoint.debug?.onResponse, {
        url,
        stream: false,
        status: res.status,
        headers: headersToRecord(res.headers),
        bodyText: text,
      });
    },
    async (err) => {
      await callDebugHookSafely(endpoint.debug?.onResponse, {
        url,
        stream: false,
        status: res.status,
        headers: headersToRecord(res.headers),
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    },
  );

  return res;
}

function wrapStreamForDebug(res: Response, url: string, debug?: LLMDebugHooks): Response {
  const body = res.body;
  if (!body || !debug?.onResponse) return res;

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const reader = body.getReader();

  const wrapped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await callDebugHookSafely(debug.onResponse, {
            url,
            stream: true,
            status: res.status,
            headers: headersToRecord(res.headers),
            bodyText: chunks.join(''),
          });
          controller.close();
          return;
        }
        chunks.push(decoder.decode(value, { stream: true }));
        controller.enqueue(value);
      } catch (err) {
        await callDebugHookSafely(debug.onResponse, {
          url,
          stream: true,
          status: res.status,
          headers: headersToRecord(res.headers),
          bodyText: chunks.join(''),
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        });
        controller.error(err);
      }
    },
    async cancel(reason) {
      await callDebugHookSafely(debug.onResponse, {
        url,
        stream: true,
        status: res.status,
        headers: headersToRecord(res.headers),
        bodyText: chunks.join(''),
        error: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
      });
      return reader.cancel(reason);
    },
  });

  return new Response(wrapped, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
