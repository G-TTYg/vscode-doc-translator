# VSCode Doc Translator

VSCode Doc Translator 计划做成一个 VS Code 插件加 CLI：用一次右键命令、命令面板命令或终端命令，快速翻译整份文档，并尽量保留原文档的结构与格式。

当前项目已有第一版 TypeScript 脚手架和可运行的本地 fake 翻译流水线。建议先读：

- `docs/design.md`：产品需求、用户流程、缓存命名、翻译服务、路线图和待确认问题。
- `docs/architecture.md`：模块边界、核心接口、数据流和验证策略。
- `docs/adr/2026-07-13-shared-core-and-sidecar-cache.md`：第一条已接受的架构决策。

## 核心思路

假设源文件是：

```text
guide.md
```

翻译到简体中文后，可能生成：

```text
guide.md
guide.auto.zh-CN.20260713T150245Z.md
.vscode-doc-translator-cache/
  guide.auto.zh-CN.20260713T150245Z.src-2c26b46b.dst-a3f9d9e1.meta.json
```

翻译后的文档是普通文件，可以直接在 VS Code 中打开。隐藏的 metadata/cache 文件记录源文件 hash、译文文件 hash、翻译服务、目标语言、格式适配器版本和新鲜度信息。

如果不想在源目录看到译文文件，可以把输出位置设为 `hidden-cache`。此时译文文件和 metadata 都会写入 `.vscode-doc-translator-cache/`，VS Code 仍会直接打开该译文文件。

## 当前状态

- 产品和架构设计：已起草。
- 共享 core：已实现第一版 `translateDocument` 流水线、命名、hash、metadata/cache 写入和新鲜度复用。
- 文件格式：已实现 plain text、语法感知 Markdown、保守 MDX、HTML/XML text-node adapter。
- Provider：已实现本地 `fake`、OpenAI-compatible、DeepL、Google、Microsoft provider 适配器。
- 大文件 AI：OpenAI-compatible provider 会按模型 `maxContextTokens` 和单次 `maxOutputTokens` 分段。每个请求用 `referenceDocument` 提供预算内最大的滑动参考上下文，用 `translationUnitIds` 指定真正要翻译的 id，并把 `maxOutputTokens` 作为 API `max_tokens` 发送；多次请求后合并 flat JSON 译文。
- Phase 2 质量项：已支持 term locks，已支持 VS Code source/translation diff preview。
- 输出位置：默认在源文件旁写可见译文；也支持 `hidden-cache`，把译文放入隐藏缓存目录。
- 缓存行为：如果源文件 hash、目标语言、provider、输出模式和译文 hash 都匹配，则直接复用缓存并打开已有译文；源文件更新后 hash 改变，会重新翻译并生成新的译文。
- 入口：已实现 CLI、VS Code extension 命令注册和 Doc Translator Settings 可视化设置面板，可在面板中选择翻译 provider 和输出位置。
- 测试：已添加 Vitest 测试。

## 开发命令

```bash
npm install
npm run compile
npm test
npm run check
```

CLI 本地烟测：

```bash
node dist/cli/main.js translate ./guide.md --to zh-CN --provider fake
node dist/cli/main.js translate ./guide.md --to zh-CN --provider fake --output hidden-cache
```

OpenAI-compatible provider 需要设置：

```bash
set DOC_TRANSLATOR_OPENAI_API_KEY=...
set DOC_TRANSLATOR_OPENAI_MODEL=...
set DOC_TRANSLATOR_OPENAI_ENDPOINT=https://api.openai.com/v1
node dist/cli/main.js translate ./guide.md --to zh-CN --provider openai-compatible
```

AI 大文件分块可设置：

```bash
node dist/cli/main.js translate ./guide.md --to zh-CN --provider openai-compatible --llm-max-context-tokens 128000 --llm-max-output-tokens 4096
```

兼容旧脚本的 `--llm-max-context-chars` 仍可用，但新配置应优先使用 token 预算。

传统 provider 环境变量：

```bash
set DOC_TRANSLATOR_DEEPL_API_KEY=...
set DOC_TRANSLATOR_GOOGLE_API_KEY=...
set DOC_TRANSLATOR_MICROSOFT_API_KEY=...
set DOC_TRANSLATOR_MICROSOFT_REGION=...
```

VS Code 插件开发可运行 `npm run compile` 后使用 `.vscode/launch.json` 的 `Run Extension`。

在 VS Code 中运行 `Doc Translator: Open Settings` 可以打开可视化设置面板；普通设置写入 VS Code settings，API key 写入 VS Code SecretStorage。
