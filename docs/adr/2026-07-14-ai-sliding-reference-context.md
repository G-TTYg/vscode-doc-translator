# ADR 2026-07-14：AI 滑动参考上下文请求

状态：Accepted
日期：2026-07-14

## 背景

AI/LLM 翻译和传统机器翻译不同。传统服务适合只接收分段文本；AI 模型需要更多上下文才能保持术语、语气和跨段语义一致。

上一版 OpenAI-compatible provider 把每个 chunk 的 `OrderedDocumentContext.units` 都视为翻译目标。这样虽然简单，但没有区分“参考上下文”和“本次真正要翻译的段落”。当文档很大、必须分块请求时，模型既缺少足够滑动上下文，也容易误翻参考段或返回不该返回的 id。

后续实现进一步发现，只用字符数限制不够。AI 请求同时受模型最大上下文窗口和单次最大输出限制影响：如果目标段落太多，即使输入还能放下，模型输出也可能超过 `max_tokens`；如果参考上下文太大，即使输出预算够，输入也可能超过模型上下文。

## 决策

AI/LLM 请求分成两个明确部分：

1. `referenceDocument.units`
   - 按原文顺序排列的上下文窗口。
   - 包含本次要翻译的目标段落，并尽量在可用输入 token 预算内向前/向后扩展。
   - 只作为翻译参考。

2. `translationUnitIds`
   - 本次真正要求模型翻译的 id 列表。
   - 模型只能返回这些 id 的译文。

共享 `StructuredLlmProvider` 管线会根据 `maxContextTokens` 和 `maxOutputTokens` 先选择连续目标 translation units，再用滑动窗口在目标范围前后扩展参考上下文。OpenAI Responses、Anthropic、Gemini 和 OpenAI-compatible adapters 复用同一分段与结果合并规则，只分别实现各自 HTTP 协议。多个请求的结果合并后交给格式适配器重建最终文档。

分段预算规则：

- `maxContextTokens` 表示模型最大上下文窗口。
- `maxOutputTokens` 表示单次响应的最大输出 token，并映射为各供应商协议对应的输出限制字段。
- 可用输入预算近似为 `maxContextTokens - maxOutputTokens - promptOverheadTokens`。
- 本次目标范围受预计输出 token 和最小输入 payload token 共同限制。
- 参考窗口使用剩余输入预算扩展，必须包含目标 units，并尽量提供目标段落前后的文章语义。

旧的 `maxContextCharacters` 保留为兼容入口，由 provider 通过 `charactersPerToken` 近似换算到 token 预算；新配置应优先使用 token 参数。

## 后果

### 正面

- 大文件 AI 翻译能在模型上下文限制内获得最大可用参考语义。
- 目标翻译 id 和参考上下文分离，降低模型误翻参考段的概率。
- 格式适配器仍然拥有最终文档重建权，provider 不能输出最终 Markdown/HTML/文本。
- `maxContextTokens` 和 `maxOutputTokens` 显式表达模型输入/输出预算，避免大文件分段只看输入长度。

### 负面 / 权衡

- 请求构造比简单 chunk 更复杂。
- 单个超长 unit 仍可能超过上下文限制；当前会单独请求并记录 warning，后续需要更细 unit 切分。
- 当前 token 估算仍基于字符数近似值，不等同于模型真实 tokenizer。

### 后续

- 加入模型 profile，让常见模型有推荐 `maxContextTokens` 和 `maxOutputTokens`。
- 对单个超长 unit 做更细拆分和合并。
- 增加 live API 验证，确认不同 OpenAI-compatible 服务都遵守 JSON mode 或兼容结构化输出。

## 参考

- `src/core/providers/structuredLlmProvider.ts`
- `src/core/providers/openAiResponsesProvider.ts`
- `src/core/providers/anthropicProvider.ts`
- `src/core/providers/geminiProvider.ts`
- `tests/openAiChunking.test.ts`
- `docs/architecture.md`
