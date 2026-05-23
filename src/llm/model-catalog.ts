/**
 * LLM 模型列表探测
 */

import { DEFAULTS } from '../config/llm.js';
import type { LLMConfig } from '../config/types.js';

export interface ModelCatalogEntry {
  id: string;
  label: string;
}

export interface ModelCatalogResult {
  provider: LLMConfig['provider'];
  baseUrl: string;
  models: ModelCatalogEntry[];
}

const DEEPSEEK_MODELS: ModelCatalogEntry[] = [
  { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash · Flash' },
  { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro · Pro' },
];

function normalizeBaseUrl(provider: LLMConfig['provider'], input?: string): string {
  const fallback = DEFAULTS[provider]?.baseUrl || '';
  let baseUrl = (input || fallback).trim().replace(/\/+$/, '');

  switch (provider) {
    case 'gemini':
      baseUrl = baseUrl
        .replace(/\/models\/[^/?#]+:streamGenerateContent(?:\?alt=sse)?$/i, '')
        .replace(/\/models\/[^/?#]+:generateContent$/i, '')
        .replace(/\/models$/i, '');
      break;
    case 'openai-compatible':
    case 'openai-responses':
    case 'deepseek':
      baseUrl = baseUrl
        .replace(/\/chat\/completions$/i, '')
        .replace(/\/responses$/i, '')
        .replace(/\/models$/i, '');
      break;
    case 'claude':
      baseUrl = baseUrl
        .replace(/\/messages$/i, '')
        .replace(/\/models$/i, '');
      break;
  }

  return baseUrl.replace(/\/+$/, '');
}

function dedupeAndSort(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  const seen = new Map<string, ModelCatalogEntry>();
  for (const entry of entries) {
    const id = entry.id.trim();
    if (!id || seen.has(id)) continue;
    seen.set(id, { id, label: entry.label?.trim() || id });
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

async function parseErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `HTTP ${res.status}`;
  try {
    const body = JSON.parse(text);
    if (typeof body?.error === 'string') return body.error;
    if (typeof body?.error?.message === 'string') return body.error.message;
    if (typeof body?.message === 'string') return body.message;
    return text;
  } catch {
    return text;
  }
}

async function requestJSON(url: string, headers: Record<string, string>, fetchImpl?: typeof fetch): Promise<any> {
  const res = await (fetchImpl ?? fetch)(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }

  return res.json();
}

function parseGeminiModels(body: any): ModelCatalogEntry[] {
  const items = Array.isArray(body?.models) ? body.models : [];
  return dedupeAndSort(items
    .filter((item: any) => {
      const methods = Array.isArray(item?.supportedGenerationMethods)
        ? item.supportedGenerationMethods.map((value: unknown) => String(value))
        : [];
      return methods.length === 0 || methods.includes('generateContent') || methods.includes('streamGenerateContent');
    })
    .map((item: any) => {
      const rawName = String(item?.name ?? '').trim();
      const id = rawName.replace(/^models\//, '');
      const displayName = String(item?.displayName ?? '').trim();
      return { id, label: displayName ? `${id} · ${displayName}` : id };
    }));
}

function parseOpenAIStyleModels(body: any): ModelCatalogEntry[] {
  const items = Array.isArray(body?.data) ? body.data : [];
  return dedupeAndSort(items.map((item: any) => {
    const id = String(item?.id ?? item?.name ?? '').trim();
    const owner = String(item?.owned_by ?? '').trim();
    return { id, label: owner ? `${id} · ${owner}` : id };
  }));
}

function parseClaudeModels(body: any): ModelCatalogEntry[] {
  const items = Array.isArray(body?.data) ? body.data : [];
  return dedupeAndSort(items.map((item: any) => {
    const id = String(item?.id ?? '').trim();
    const displayName = String(item?.display_name ?? '').trim();
    return { id, label: displayName ? `${id} · ${displayName}` : id };
  }));
}

export async function listAvailableModels(config: Pick<LLMConfig, 'provider' | 'apiKey' | 'baseUrl' | 'fetch'>): Promise<ModelCatalogResult> {
  const provider = config.provider;
  const apiKey = config.apiKey?.trim() || '';
  const baseUrl = normalizeBaseUrl(provider, config.baseUrl);

  if (provider === 'deepseek' && !apiKey) {
    return { provider, baseUrl, models: DEEPSEEK_MODELS };
  }

  if (!apiKey) {
    throw new Error('缺少 API Key');
  }
  if (!baseUrl) {
    throw new Error('缺少 API 地址');
  }

  switch (provider) {
    case 'gemini': {
      const body = await requestJSON(`${baseUrl}/models?pageSize=1000`, {
        'x-goog-api-key': apiKey,
      }, config.fetch);
      return { provider, baseUrl, models: parseGeminiModels(body) };
    }
    case 'openai-compatible':
    case 'openai-responses':
    case 'deepseek': {
      const body = await requestJSON(`${baseUrl}/models`, {
        Authorization: `Bearer ${apiKey}`,
      }, config.fetch);
      return { provider, baseUrl, models: parseOpenAIStyleModels(body) };
    }
    case 'claude': {
      const body = await requestJSON(`${baseUrl}/models`, {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }, config.fetch);
      return { provider, baseUrl, models: parseClaudeModels(body) };
    }
    default:
      throw new Error(`暂不支持提供商 ${provider} 的模型列表拉取`);
  }
}
