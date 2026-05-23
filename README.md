# unified-llm-interface

统一 LLM 接口 npm 包。

它的目标不是让用户自己处理各家格式差异，而是：

- 你可以只维护一种输入/输出格式
- 你可以显式指定要把请求体**转成什么格式**
- `thoughtSignature` / `thoughtSignatures` 会跟着请求体格式一起处理
- 不需要单独再指定“签名格式类型”

---

## 当前内置支持

- `unified`：包的统一格式（推荐用户长期维护这个）
- `gemini`
- `claude`
- `openai-compatible`
- `openai-responses`
- `deepseek`（wire format 视为 `openai-compatible`）

---

## 设计原则

### 1. 用户主要关心的是“格式 from/to”

不是：
- 我该把签名声明成 Gemini 还是 Claude？

而是：
- 我现在手里的请求体是什么格式？
- 我要把它转成什么格式？

签名会随格式转换一起处理。

### 1.1 一个最重要的例子

假设：

- 用户维护的是 `claude` 格式历史
- 历史里已有 `claude` 原生签名
- 这次实际要调用的是 `gemini`

那么规则是：

1. `from = claude`
2. 实际 provider = `gemini`
3. 组装 Gemini 请求时，只找 **Gemini 可用签名**
4. 如果当前历史里没有 `gemini:` 对应签名，就等价于 **这轮不传签名**
5. 模型返回后，如果你要继续返回 `claude` 格式给用户，那么 `signature` 字段会写成 `gemini:xxxx`，因为这条签名实际属于 Gemini

### 2. 不伪造跨 provider 原生签名

### 2.1 OpenAI 系前缀现在明确拆分

为了避免歧义，这个包不再把 OpenAI 系签名统称成 `openai:`。

现在公开前缀建议是：

- `openai-compatible:`
- `openai-responses:`

旧的 `openai:` 输入已删除。
如果你之前使用过 `openai:`，现在必须明确改成 `openai-compatible:` 或 `openai-responses:`。


这个包会：
- 自动识别签名
- 自动归一化
- 自动带上统一前缀（在 `unified` 输出里）
- 自动放回目标格式对应的位置

但**不会**做这种错误事情：
- 把 Gemini 原生签名“变成”Claude 原生签名
- 把 Claude 原生签名“变成”OpenAI 原生签名

也就是说：
- Claude 签名仍然是 Claude 签名
- OpenAI Compatible 扩展签名仍然是 `openai-compatible` 签名
- OpenAI Responses `encrypted_content` 仍然是 `openai-responses` 签名
- Gemini thought signature 仍然是 Gemini 签名

---

## `unified` 格式是什么

`unified` 是这个包对外推荐的统一格式。

它基于 Gemini-like message 结构，但额外兼容：

- `thoughtSignature: string`
- `thoughtSignatures: { [provider]: string }`

其中 `provider` 推荐使用完整命名空间：`gemini | claude | openai-compatible | openai-responses`

典型例子：

```ts
const request = {
  contents: [
    { role: 'user', parts: [{ text: 'hello' }] },
    {
      role: 'model',
      parts: [
        {
          text: 'thinking...',
          thought: true,
          thoughtSignature: 'claude:sig_xxx',
        },
        { text: 'final answer' },
      ],
    },
  ],
};
```

---

## 安装

```bash
npm install unified-llm-interface
```

---

## 最常用的两种方式

## 方式 1：直接做格式转换

### `convertRequest`

把一个请求体从 A 格式转成 B 格式。

```ts
import { convertRequest } from 'unified-llm-interface';

const claudeRequest = convertRequest({
  contents: [
    { role: 'user', parts: [{ text: 'hello' }] },
    {
      role: 'model',
      parts: [
        {
          text: 'deep thought',
          thought: true,
          thoughtSignature: 'claude:sig_req_1',
        },
      ],
    },
  ],
}, {
  from: 'unified',
  to: 'claude',
  model: 'claude-sonnet-4',
});
```

这里你只指定：
- `from: 'unified'`
- `to: 'claude'`

签名会自动跟着请求体转换到 Claude 的 `thinking.signature` 位置。

---

### `convertResponse`

把一个响应体从 A 格式转成 B 格式。

```ts
import { convertResponse } from 'unified-llm-interface';

const unifiedResponse = convertResponse({
  content: [
    { type: 'thinking', thinking: 'let me think', signature: 'sig_resp_1' },
    { type: 'text', text: 'done' },
  ],
  stop_reason: 'end_turn',
}, {
  from: 'claude',
  to: 'unified',
});
```

输出里会自动变成：

```ts
thoughtSignature: 'claude:sig_resp_1'
```

---

### `createStreamConverter`

把流式 chunk / event 从一种格式转成另一种格式。

```ts
import { createStreamConverter } from 'unified-llm-interface';

const converter = createStreamConverter({
  from: 'claude',
  to: 'unified',
});

const chunk = converter.convert({
  type: 'content_block_delta',
  delta: { type: 'signature_delta', signature: 'sig_stream_1' },
});
```

---

## 方式 2：直接调用 provider，但输入输出格式可自选

### `provider.chat()`

你可以调用一个实际 provider，但输入和输出不一定要等于它自己的原生格式。

比如：
- 实际调用的是 Claude
- 输入给包的是 `openai-compatible`
- 输出要回 `unified`

```ts
import { createClaudeProvider } from 'unified-llm-interface';

const provider = createClaudeProvider({
  provider: 'claude',
  model: 'claude-sonnet-4',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const response = await provider.chat({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: 'You are helpful' },
    { role: 'user', content: 'hello' },
  ],
}, {
  inputFormat: 'openai-compatible',
  outputFormat: 'unified',
});
```

流程会是：

```text
openai-compatible request
  -> decode to unified canonical
  -> encode to claude request
  -> call Claude API
  -> decode Claude response
  -> encode back to unified response
```

签名也跟着这条链一起走，不用你单独声明“签名转成什么格式”。

---

## Router / Factory

### 创建内置注册表

```ts
import { createBootstrapExtensionRegistry } from 'unified-llm-interface';

const registry = createBootstrapExtensionRegistry();
```

### 通过 factory 创建 provider

```ts
import { createBootstrapExtensionRegistry, createLLMFromConfig } from 'unified-llm-interface';

const registry = createBootstrapExtensionRegistry();
const provider = createLLMFromConfig({
  provider: 'claude',
  model: 'claude-sonnet-4',
  apiKey: process.env.ANTHROPIC_API_KEY,
  endpoint: {
    url: 'https://example.com/custom/messages',
    headers: {
      'x-endpoint-header': 'demo',
    },
  },
  headers: {
    'x-top-header': 'top',
  },
  requestBody: {
    metadata: { source: 'my-app' },
  },
}, registry.llmProviders);
```

支持：
- 自定义 `url`
- 自定义 `streamUrl`
- 自定义 `headers`
- 自定义 `requestBody`
- 自定义 `fetch`
- 自定义超时

---

### 创建 router

```ts
import { createBootstrapExtensionRegistry, createLLMRouter } from 'unified-llm-interface';

const registry = createBootstrapExtensionRegistry();

const router = createLLMRouter({
  defaultModelName: 'main',
  models: [
    {
      modelName: 'main',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      apiKey: process.env.GEMINI_API_KEY,
    },
    {
      modelName: 'backup',
      provider: 'claude',
      model: 'claude-sonnet-4',
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  ],
}, undefined, registry.llmProviders);
```

---

## thought signature 规则

## 输入兼容两种写法

### 字符串写法

```ts
thoughtSignature: 'claude:sig_xxx'
```

### 对象写法

```ts
thoughtSignatures: {
  claude: 'sig_xxx'
}
```

---

## 你现在不需要再单独指定“签名格式类型”

你主要只需要指定：

- `from`
- `to`

或者：

- `inputFormat`
- `outputFormat`

签名会跟着格式走。

### 具体来说是什么意思？

比如你传入的是 `claude` 格式：

```ts
await provider.chat(claudeLikeHistory, {
  inputFormat: 'claude',
  // 实际 provider 是 gemini
  // outputFormat 不写时，默认回到 inputFormat，也就是 claude
});
```

此时：

- 请求发给 Gemini 之前，会先检查历史里有没有 `gemini` 可用签名
- 如果只有 `claude` 原生签名，没有 `gemini:` 前缀签名，那么就**不把 Claude 签名错误地发给 Gemini**
- Gemini 返回后，再编码回 `claude` 格式
- 但返回给你的 `claude` thinking block 里的 `signature` 会是：

```ts
signature: 'gemini:xxxx'
```

同理，如果实际调用的是 `openai-responses`，那么回到其他结构时会写成 `openai-responses:xxxx`，不会再写成模糊的 `openai:xxxx`。

这样你下次继续把这份 `claude` 格式历史传回来时，包就能知道：这不是 Claude 原生签名，而是 Gemini 原生签名，只是被保存在 Claude 风格结构里。

---

## `unified` 输出时的默认策略

### 默认优先字符串

如果结果里只有一个可明确归属的签名，`unified` 输出默认会是：

```ts
thoughtSignature: 'claude:sig_xxx'
```

### 如果你的 `unified` 输入本来就是对象签名

在 `provider.chat(..., { inputFormat: 'unified', outputFormat: 'unified' })` 这类场景里，
如果你原本传的是：

```ts
thoughtSignatures: { claude: 'sig_xxx' }
```

包会尽量延续对象形式。

### 高级场景仍可手动控制

底层 `encode* / convert*` API 仍然保留 `signatureMode` 这样的高级参数，
但正常使用时，你通常不需要碰它。

---

## 推荐实践

### 最推荐

- 长期维护 `unified`
- 真正发请求时按需转成目标 provider 格式
- 返回时再转回 `unified`

这样用户业务代码最稳定。

### 适合中转网关 / 兼容层

- 上游输入 `openai-compatible`
- 下游实际调用 `claude`
- 输出再转回 `openai-compatible` 或 `unified`

---

## 当前状态

当前 `新项目/` 里的独立包已经完成：

- 独立 `package.json`
- TypeScript 构建
- Vitest 测试
- 内置 provider / format 注册表
- request / response / stream from-to 转换
- provider 调用桥接
- thought signature 跟随格式自动处理

已验证通过：

```bash
cd 新项目
npm run test
npm run build
```
