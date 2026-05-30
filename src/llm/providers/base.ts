/**
 * LLM Provider 组合器
 */

import type { LLMRequest, LLMResponse, LLMStreamChunk } from '../../types/index.js';
import type { FormatId, UnifiedSignatureMode } from '../convert.js';
import { decodeRequestFromFormat, encodeResponseToFormat, encodeStreamChunkToFormat, normalizeFormatId } from '../convert.js';
import type { FormatAdapter } from '../formats/types.js';
import { detectLLMRequestSignatureRepresentation } from '../../signatures/normalize.js';
import { sendRequest, type EndpointConfig } from '../transport.js';
import type { LLMProxyOption } from '../../config/types.js';
import { processResponse, processStreamResponse } from '../response.js';
import type { FormatRegistry } from '../../registry/formats.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeObjects(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMergeObjects(current, value);
    } else if (Array.isArray(current) && Array.isArray(value)) {
      result[key] = [...current, ...value];
    } else if (Array.isArray(current) && value !== null && typeof value === 'object') {
      result[key] = [...current, value];
    } else {
      result[key] = value;
    }
  }
  return result;
}

function mergeRequestBody(baseBody: unknown, overrideBody?: Record<string, unknown>): unknown {
  if (!overrideBody) return baseBody;
  if (!isPlainObject(baseBody)) return overrideBody;
  return deepMergeObjects(baseBody, overrideBody);
}

export interface LLMCallOptions {
  signal?: AbortSignal;
  /** 输入使用的格式，默认 unified */
  inputFormat?: FormatId;
  /** 输出想要的格式，默认跟随 inputFormat */
  outputFormat?: FormatId;
  /** 自定义格式注册表 */
  formatRegistry?: Pick<FormatRegistry, 'get'>;
  /** 本次调用显式指定 HTTP/HTTPS 代理；传空字符串可临时禁用 provider 默认代理 */
  proxy?: LLMProxyOption;
}

export interface LLMProviderLike {
  setLogging(logsDir: string): void;
  chat<TOutput = LLMResponse>(request: unknown, options?: LLMCallOptions): Promise<TOutput>;
  chatStream<TOutput = LLMStreamChunk>(request: unknown, options?: LLMCallOptions): AsyncGenerator<TOutput>;
  patchRequestBodyOverrides?(patch: Record<string, unknown>): void;
  removeRequestBodyOverridePaths?(...paths: string[]): void;
  removeRequestBodyOverrideKeys?(...keys: string[]): void;
  readonly name: string;
}

export class LLMProvider implements LLMProviderLike {
  private providerName: string;
  private loggingDir?: string;
  private runtimeOverrides?: Record<string, unknown>;

  constructor(
    private format: FormatAdapter,
    private endpoint: EndpointConfig,
    providerName?: string,
    private staticOverrides?: Record<string, unknown>,
    private providerFormat: FormatId = 'unified',
  ) {
    this.providerName = providerName ?? 'LLMProvider';
  }

  private get effectiveOverrides(): Record<string, unknown> | undefined {
    if (!this.runtimeOverrides && !this.staticOverrides) return undefined;
    if (!this.runtimeOverrides) return this.staticOverrides;
    if (!this.staticOverrides) return this.runtimeOverrides;
    return deepMergeObjects(this.runtimeOverrides, this.staticOverrides);
  }

  private resolveInputFormat(options?: LLMCallOptions): FormatId {
    return options?.inputFormat ?? 'unified';
  }

  private resolveOutputFormat(inputFormat: FormatId, options?: LLMCallOptions): FormatId {
    return options?.outputFormat ?? inputFormat;
  }

  private resolveUnifiedSignatureMode(request: LLMRequest, inputFormat: FormatId, outputFormat: FormatId): UnifiedSignatureMode | undefined {
    if (normalizeFormatId(outputFormat) !== 'unified') return undefined;
    if (normalizeFormatId(inputFormat) === 'unified') {
      return detectLLMRequestSignatureRepresentation(request) === 'object' ? 'object' : 'string';
    }
    return 'string';
  }

  private resolveEndpoint(options?: LLMCallOptions): EndpointConfig {
    return options && 'proxy' in options ? { ...this.endpoint, proxy: options.proxy } : this.endpoint;
  }

  setLogging(logsDir: string): void {
    this.loggingDir = logsDir;
  }

  async chat<TOutput = LLMResponse>(request: unknown, options?: LLMCallOptions): Promise<TOutput> {
    const inputFormat = this.resolveInputFormat(options);
    const outputFormat = this.resolveOutputFormat(inputFormat, options);
    const canonicalRequest = decodeRequestFromFormat(request, {
      format: inputFormat,
      registry: options?.formatRegistry,
    });

    const body = mergeRequestBody(this.format.encodeRequest(canonicalRequest, false), this.effectiveOverrides);
    const res = await sendRequest(this.resolveEndpoint(options), body, false, undefined, options?.signal, this.loggingDir);
    const canonicalResponse = await processResponse(res, this.format);

    return encodeResponseToFormat(canonicalResponse, {
      format: outputFormat,
      sourceFormat: this.providerFormat,
      registry: options?.formatRegistry,
      signatureMode: this.resolveUnifiedSignatureMode(canonicalRequest, inputFormat, outputFormat),
    }) as TOutput;
  }

  async *chatStream<TOutput = LLMStreamChunk>(request: unknown, options?: LLMCallOptions): AsyncGenerator<TOutput> {
    const inputFormat = this.resolveInputFormat(options);
    const outputFormat = this.resolveOutputFormat(inputFormat, options);
    const canonicalRequest = decodeRequestFromFormat(request, {
      format: inputFormat,
      registry: options?.formatRegistry,
    });

    const body = mergeRequestBody(this.format.encodeRequest(canonicalRequest, true), this.effectiveOverrides);
    const res = await sendRequest(this.resolveEndpoint(options), body, true, undefined, options?.signal, this.loggingDir);

    for await (const chunk of processStreamResponse(res, this.format)) {
      yield encodeStreamChunkToFormat(chunk, {
        format: outputFormat,
        sourceFormat: this.providerFormat,
        registry: options?.formatRegistry,
        signatureMode: this.resolveUnifiedSignatureMode(canonicalRequest, inputFormat, outputFormat),
      }) as TOutput;
    }
  }

  patchRequestBodyOverrides(patch: Record<string, unknown>): void {
    this.runtimeOverrides = this.runtimeOverrides
      ? deepMergeObjects(this.runtimeOverrides, patch)
      : { ...patch };
  }

  removeRequestBodyOverrideKeys(...keys: string[]): void {
    if (!this.runtimeOverrides) return;
    for (const key of keys) {
      delete this.runtimeOverrides[key];
    }
    if (Object.keys(this.runtimeOverrides).length === 0) {
      this.runtimeOverrides = undefined;
    }
  }

  removeRequestBodyOverridePaths(...paths: string[]): void {
    if (!this.runtimeOverrides) return;
    for (const path of paths) {
      const segments = path.split('.');
      if (segments.length === 1) {
        delete this.runtimeOverrides[segments[0]];
        continue;
      }

      let obj: Record<string, unknown> = this.runtimeOverrides;
      const parents: Array<{ obj: Record<string, unknown>; key: string }> = [];
      let valid = true;
      for (let i = 0; i < segments.length - 1; i++) {
        parents.push({ obj, key: segments[i] });
        const child = obj[segments[i]];
        if (!isPlainObject(child)) {
          valid = false;
          break;
        }
        obj = child;
      }

      if (!valid) continue;

      delete obj[segments[segments.length - 1]];
      for (let i = parents.length - 1; i >= 0; i--) {
        const { obj: parent, key } = parents[i];
        const child = parent[key];
        if (isPlainObject(child) && Object.keys(child).length === 0) {
          delete parent[key];
        } else {
          break;
        }
      }
    }

    if (Object.keys(this.runtimeOverrides).length === 0) {
      this.runtimeOverrides = undefined;
    }
  }

  get name(): string {
    return this.providerName;
  }
}
