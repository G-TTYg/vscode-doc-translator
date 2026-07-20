# ADR 2026-07-20：原生 LLM API 适配器

状态：Accepted
日期：2026-07-20

## 背景

项目原有 `openai-compatible` provider 只调用 Chat Completions。OpenAI Responses、Anthropic Messages 和 Gemini GenerateContent 虽然都能完成结构化翻译，但端点、认证头、输出 token 字段、结构化输出配置和响应文本位置并不兼容。仅切换 endpoint 无法正确支持这些协议。

同时，四类 AI provider 仍需要完全相同的文档分块、滑动参考上下文、缺失 id 补请求、JSON 恢复和结果排序行为。如果每个 adapter 各自复制这部分流程，修复会很快出现分叉。

## 决策

1. 保留 `openai-compatible`，明确其协议为 Chat Completions。
2. 新增三个稳定 provider id：`openai-responses`、`anthropic`、`gemini`。
3. 抽出 `StructuredLlmProvider`，统一负责 ordered JSON context 分块、输出预算、缺失 id 重试、JSON 解析与排序。
4. 原生 adapters 只拥有供应商协议细节：
   - OpenAI：`POST /responses`、Bearer auth、`text.format.json_schema`、`max_output_tokens`。
   - Anthropic：`POST /v1/messages`、`x-api-key`、`anthropic-version: 2023-06-01`、`output_config.format`、`max_tokens`。
   - Gemini：`POST models/{model}:generateContent`、`x-goog-api-key`、`generationConfig.responseJsonSchema`、`maxOutputTokens`。
5. 每个供应商使用独立 SecretStorage key，避免切换 provider 时误用另一家的凭据。
6. 默认 provider 改为 `openai-responses`；模型名保持空值，要求用户从可视化设置面板填写账号实际可用模型。

## 后果

### 正面

- 三个原生 API 不依赖不可靠的“兼容模式”假设。
- 共享翻译不变量只维护一份。
- Provider mock tests 可以直接验证 URL、请求头、请求体和响应解析。
- 可视化设置可以只显示当前 provider 的端点、模型和密钥。

### 负面 / 权衡

- Provider 和设置项数量增加。
- 结构化输出能力仍取决于用户所选模型；账号不支持该模型或 schema 时，API 会返回可行动的错误。
- Live 验证需要用户自己的凭据、地区权限和配额，不能纳入普通测试。

## 官方规范依据

- OpenAI OpenAPI：<https://github.com/openai/openai-openapi>
- OpenAI Responses guide：<https://platform.openai.com/docs/guides/migrate-to-responses>
- Anthropic TypeScript SDK / Messages contract：<https://github.com/anthropics/anthropic-sdk-typescript>
- Anthropic Messages API：<https://platform.claude.com/docs/en/api/messages>
- Google Gen AI TypeScript SDK：<https://github.com/googleapis/js-genai>
- Gemini structured output：<https://ai.google.dev/gemini-api/docs/structured-output>

## 相关文件

- `src/core/providers/structuredLlmProvider.ts`
- `src/core/providers/openAiResponsesProvider.ts`
- `src/core/providers/anthropicProvider.ts`
- `src/core/providers/geminiProvider.ts`
- `tests/nativeLlmProviders.test.ts`
