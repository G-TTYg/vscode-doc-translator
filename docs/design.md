# VSCode Doc Translator 设计文档

最后更新：2026-07-20
状态：实现中

## 1. 目标

构建一个 VS Code 插件，用来快速、准确、可重复地翻译整份文档，并在支持的文件类型中尽量保留原文档结构与格式。

翻译结果默认保存在源文件同目录，作为一份普通文件被 VS Code 打开。插件同时在同目录创建专用隐藏目录 `.vscode-doc-translator-cache/`，把 metadata/cache 边车文件放在里面，用 hash、文件名、时间戳、翻译服务和 schema version 把源文档与译文文档耦合起来。

## 2. 产品原则

- 整份文档翻译应该是一键动作：VS Code 右键菜单或命令面板命令。
- 永远不覆盖源文档。
- 译文文件名必须清楚标记为自动翻译，不能和原文档混淆。
- 保留格式是核心需求，不是翻译完之后再补救的附加项。
- 翻译服务必须可替换：OpenAI Responses、Anthropic、Gemini、OpenAI-compatible、Google、DeepL 和 Microsoft 都通过适配器接入。
- 缓存 metadata 必须能判断译文是否来自当前最新版源文档，以及译文文件是否被用户手动改过。
- Metadata/cache 必须放进专用隐藏目录，默认目录名为 `.vscode-doc-translator-cache/`，避免和用户项目中泛用的 metadata 目录冲突。
- API Key、Bearer Token 等 secrets 不能写入 cache、metadata 或日志。

## 3. 主要用户流程

### VS Code：翻译当前编辑器文件

1. 用户在 VS Code 中打开一个文件。
2. 用户通过命令面板、编辑器右键菜单或标题栏命令运行 `Doc Translator: Translate Current Document`。
3. 如果没有默认配置，插件询问目标语言和翻译服务。
4. 插件调用共享核心翻译流程。
5. 插件在源文件同目录写入可见译文文件，并在 `.vscode-doc-translator-cache/` 写入 metadata/cache。
6. 插件在新编辑器标签页打开译文文件。
7. 插件在 VS Code 右下角状态栏显示运行中、阶段进度、成功、缓存命中或失败状态。
8. 插件提示本次结果是新翻译、缓存命中、部分恢复还是失败。

### VS Code：从文件资源管理器翻译

1. 用户在 VS Code Explorer 中右键一个文件。
2. 用户选择 `Translate Document`。
3. 插件复用同一条核心翻译流程，并打开输出文件。

## 4. 文件类型支持范围

### MVP

| 类型 | 扩展名 | 保格式策略 |
| --- | --- | --- |
| Plain text | `.txt` 和未知文本文件 | 按段落切分，保留段落周围空白、空行和换行风格。 |
| Markdown | `.md`, `.markdown` | 基于 AST 抽取可翻译文本；保留 frontmatter、标题层级、列表、代码块、行内代码、链接目标、图片、表格和可识别 HTML 块。 |

### Provider-specific 解析与请求策略

同一种文件格式会根据 provider 类型使用不同请求形态，但格式重建仍由同一个格式适配器负责。

| Provider 类型 | 输入策略 | 输出要求 | 重建方式 |
| --- | --- | --- | --- |
| 传统机器翻译：Google、DeepL、Microsoft | 格式适配器抽取 translation units，按段落或语义块分批翻译。 | 返回每个 unit 的译文，顺序和数量必须与请求一致，或显式带 id。 | 使用 unit id/顺序把译文放回原 AST/文本结构。 |
| AI/LLM：OpenAI Responses、Anthropic、Gemini、OpenAI-compatible | 格式适配器生成按原文顺序排列的全文 JSON 上下文；共享 LLM 管线再按模型最大上下文构造滑动窗口，供应商适配器只负责各自 HTTP 协议。 | 请求中 `referenceDocument.units` 是参考上下文，`translationUnitIds` 是目标翻译 id；输出格式化扁平 JSON。每个目标 id 必须出现；如果某个 unit 不需要翻译，应显式返回 `skip`。共享管线会恢复被包裹的 JSON，并对缺失 id 发起一次只包含缺失 unit 的补请求。 | 校验 id 完整性、重复、缺失和 protected token 后，由格式适配器重建译文文档。 |

AI/LLM 不能直接输出最终 Markdown 或最终纯文本文件，因为这样很难可靠保留格式。它可以看到按原文档顺序组织的完整文本上下文，但只能把每个 id 的译文交回核心流程。

### 下一阶段

| 类型 | 扩展名 | 说明 |
| --- | --- | --- |
| MDX | `.mdx` | 已实现保守适配器：保留 import/export/JSX 结构行，只翻译 Markdown 文本节点。 |
| HTML/XML | `.html`, `.htm`, `.xml` | 已实现 text-node 适配器：翻译标签外文本节点，跳过 script/style。 |
| JSON/YAML/TOML | `.json`, `.yaml`, `.yml`, `.toml` | 默认不盲目翻译，需配置可翻译字段，避免破坏机器可读配置。 |
| reStructuredText / AsciiDoc | `.rst`, `.adoc` | 需要专门适配器和 fixture 测试后再承诺保真。 |

### MVP 明确不做

`.docx`、`.pptx`、`.xlsx`、`.pdf` 这类二进制或强排版文件不进入 MVP。它们需要单独解析、重建和渲染验证，应以后通过专用格式适配器接入。

## 5. 翻译服务

计划支持：

- Google Cloud Translation API
- DeepL API
- Microsoft Translator / Azure AI Translator
- OpenAI Responses API
- Anthropic Messages API
- Gemini GenerateContent API
- OpenAI-compatible Chat Completions API，包括本地网关或其他兼容服务

所有 provider 统一隐藏在接口后面：

```ts
interface TranslationProvider {
  readonly id: string;
  readonly displayName: string;
  translateBatch(request: TranslateBatchRequest): Promise<TranslateBatchResult>;
  estimateCost?(request: TranslateBatchRequest): Promise<CostEstimate>;
  detectLanguage?(text: string): Promise<LanguageDetectionResult>;
}
```

Provider 适配器需要暴露能力信息，例如单批最大字符数/Token 数、是否支持 glossary、是否支持 formality、速率限制、是否支持结构化 JSON 输出。

核心流程会根据 provider capability 决定请求 packaging：

- `segmented-units`：传统机器翻译默认模式，强调批量、稳定、成本可控。
- `ordered-json-context`：AI/LLM 默认模式，强调全文顺序上下文和术语一致性。
- AI/LLM provider 必须支持 token 预算分段。当前主要设置是 `docTranslator.llm.maxContextTokens` 和 `docTranslator.llm.maxOutputTokens`：前者表示模型最大上下文窗口，后者表示单次响应请求的最大输出 token；原生适配器分别映射为 OpenAI `max_output_tokens`、Anthropic `max_tokens`、Gemini `maxOutputTokens` 或 Chat Completions `max_tokens`。旧的 `docTranslator.llm.maxContextCharacters` 仅保留为兼容旧配置的近似换算入口。
- AI/LLM 单次请求先按原文顺序选择连续目标 units。目标范围受两类预算限制：预计输出不能超过 `maxOutputTokens`，目标 units 自身组成的最小输入 payload 也不能超过可用输入预算。
- 可用输入预算近似为 `maxContextTokens - maxOutputTokens - promptOverheadTokens`。确定目标范围后，provider 会用剩余输入预算扩展 `referenceDocument.units`：必须包含本次目标 units，并尽量向目标范围前后扩展，让模型看到足够的上文、下文和文章语义。模型只能翻译 `translationUnitIds` 指定的 id，不能翻译参考窗口里的其他 id。

## 6. 准确性策略

翻译质量不仅取决于 provider，也取决于文档处理方式。

- 使用格式适配器避免翻译语法结构、代码块、URL、frontmatter key、Markdown 链接目标、占位符等保护内容。
- 将文档拆成稳定的 translation units。Markdown 的 unit id 可以由 AST path、序号和源文本 hash 共同生成。
- 传统机器翻译按 translation units 分段/分批翻译，优先保证格式安全、速度和 provider 兼容性。
- AI/LLM provider 接收 ordered JSON context：按原文档顺序列出全部可翻译文本块、id、类型、上下文和 protected token。LLM 必须返回扁平 JSON 译文列表，并校验每个 id 恰好出现一次。
- `accurate` profile 可以加入复核流程：先翻译，再检查术语一致性、保护 token、格式 token，最后只修复失败 unit。
- 后续支持 glossary 和 term lock：产品名、API 名、代码标识符或用户指定术语不被翻译。
- 检测可疑结果：缺失 unit、重复 unit、大段未翻译、占位符损坏、保护 token 改变、长度比例异常、provider 错误、JSON 非法。

## 7. 保格式策略

不能把“整份文档翻译”做成简单字符串替换。核心流程应该是：

1. 以 bytes 读取源文件并解码文本。
2. 从原始 bytes 计算 source hash。
3. 选择文档格式适配器。
4. 将文档解析成中间模型。
5. 抽取可翻译 unit 和 protected spans。
6. 根据 provider capability 构造请求：传统 MT 使用分段 units，AI/LLM 使用 ordered JSON context。
7. 只接收按 unit id 返回的译文结果，不接收 provider 直接生成的最终文件。
8. 校验译文是否破坏 protected spans、id 完整性和适配器规则。
9. 重建文档，尽量保留原结构、顺序、换行风格和周围空白。
10. 从输出 bytes 计算 translated hash。
11. 原子写入译文文件和 metadata sidecar。

如果文件类型不支持或风险过高，工具应明确拒绝，或要求用户显式选择 plain text fallback，并提示格式可能无法保留。

## 8. 输出与缓存设计

### 默认输出布局

源文件：

```text
guide.md
```

2026-07-13 `15:02:45Z` 翻译到简体中文后生成：

```text
guide.auto.zh-CN.20260713T150245Z.md
.vscode-doc-translator-cache/
  guide.auto.zh-CN.20260713T150245Z.src-2c26b46b.dst-a3f9d9e1.meta.json
```

规则：

- 译文文件默认保持可见，因为它是用户会打开、阅读、编辑的普通文档。
- 可选 `hidden-cache` 输出模式会把译文文件也放入 `.vscode-doc-translator-cache/`，适合不想在源目录看到自动译文的用户。即使在隐藏目录中，译文仍然是普通文件，VS Code 可以直接打开。
- metadata 放在源文件同目录下的专用隐藏目录 `.vscode-doc-translator-cache/`。在 Windows 上，插件应尽量额外设置 hidden 属性。
- 译文文件名包含 `auto`、目标语言和时间戳，避免和源文件混淆。
- metadata 文件名包含源文件 hash 前缀和译文 hash 前缀，方便人眼快速判断。
- 完整 hash 存在 metadata 内。
- 时间戳使用 UTC `YYYYMMDDTHHmmssZ`，便于排序并避免时区歧义。
- Markdown 译文可以按用户设置加入可选 HTML 注释头，但 metadata JSON 仍然是权威信息来源，不能依赖注释头保存完整状态。

### 命名规则

可见译文文档：

```text
<sourceBase>.auto.<targetLanguage>.<timestamp><sourceExtension>
```

隐藏 metadata：

```text
.vscode-doc-translator-cache/<sourceBase>.auto.<targetLanguage>.<timestamp>.src-<sourceHash8>.dst-<translatedHash8>.meta.json
```

例子：

```text
README.auto.en.20260713T150245Z.md
product-spec.auto.zh-CN.20260713T150245Z.md
notes.auto.ja.20260713T150245Z.txt
```

### Metadata schema 草案

```json
{
  "schemaVersion": 1,
  "translationId": "guide.md:sha256:2c26b46b...:zh-CN:20260713T150245Z",
  "status": "complete",
  "createdAt": "2026-07-13T15:02:45Z",
  "source": {
    "relativePath": "guide.md",
    "sha256": "2c26b46b...",
    "sizeBytes": 12345,
    "mtimeUtc": "2026-07-13T14:58:11Z",
    "language": "auto"
  },
  "target": {
    "language": "zh-CN",
    "relativePath": "guide.auto.zh-CN.20260713T150245Z.md",
    "directoryMode": "same-dir",
    "sha256": "a3f9d9e1...",
    "sizeBytes": 23456
  },
  "format": {
    "adapter": "markdown",
    "adapterVersion": "0.1.0",
    "lineEnding": "lf",
    "encoding": "utf8"
  },
  "provider": {
    "id": "deepl",
    "modelOrApiVersion": "v2",
    "endpointLabel": "default",
    "requestPackaging": "segmented-units"
  },
  "profile": {
    "name": "accurate",
    "hash": "profile-hash"
  },
  "pipeline": {
    "coreVersion": "0.1.0",
    "segmenterVersion": "0.1.0",
    "segmentCount": 42,
    "translatedSegmentCount": 42,
    "markdownHeaderInserted": false,
    "warnings": []
  }
}
```

metadata 不能包含 API Key 或 Bearer Token。可以包含 provider id、endpoint label、模型名和非敏感 profile hash。

### 新鲜度与编辑检测

- 源文档 fresh：当前源文件 hash 等于 `metadata.source.sha256`。
- 源文档 stale：当前源文件 hash 不等于 `metadata.source.sha256`。
- 译文未被编辑：当前译文文件 hash 等于 `metadata.target.sha256`。
- 译文已被编辑：当前译文文件 hash 不等于 `metadata.target.sha256`。工具不能静默覆盖它。
- 当源文档未变化、目标语言一致、provider 一致、输出模式一致且译文未被编辑，插件可直接打开缓存译文。
- 当源文档已变化，默认创建新的译文文件。未来可以用 segment-level cache 复用未变化的 unit。
- 可选设置 `docTranslator.cache.deleteStaleAutoTranslations` 默认为关闭。开启后，插件在新译文成功创建时清理同一源文件、目标语言、provider 和输出模式下的旧自动译文；只有旧译文当前 hash 仍等于 metadata 记录的 target hash 时才会删除，已被用户编辑的译文必须保留。

## 9. 配置

计划中的 VS Code settings：

```json
{
  "docTranslator.defaultTargetLanguage": "zh-CN",
  "docTranslator.defaultProvider": "openai-responses",
  "docTranslator.profile": "accurate",
  "docTranslator.output.directoryMode": "same-dir",
  "docTranslator.output.openAfterTranslate": true,
  "docTranslator.output.showDiffAfterTranslate": false,
  "docTranslator.termLocks": ["OpenAI", "VS Code"],
  "docTranslator.cache.hiddenDirectoryName": ".vscode-doc-translator-cache",
  "docTranslator.cache.deleteStaleAutoTranslations": false,
  "docTranslator.openai.endpoint": "https://api.openai.com/v1",
  "docTranslator.openai.model": "your-openai-model",
  "docTranslator.anthropic.endpoint": "https://api.anthropic.com",
  "docTranslator.anthropic.model": "your-anthropic-model",
  "docTranslator.gemini.endpoint": "https://generativelanguage.googleapis.com/v1beta",
  "docTranslator.gemini.model": "your-gemini-model",
  "docTranslator.llm.endpoint": "https://api.example.com/v1",
  "docTranslator.llm.model": "your-model-name",
  "docTranslator.llm.maxContextTokens": 128000,
  "docTranslator.llm.maxOutputTokens": 4096,
  "docTranslator.deepl.endpoint": "https://api-free.deepl.com",
  "docTranslator.google.endpoint": "https://translation.googleapis.com",
  "docTranslator.microsoft.endpoint": "https://api.cognitive.microsofttranslator.com",
  "docTranslator.microsoft.region": "",
  "docTranslator.markdown.insertAutoTranslationHeader": false,
  "docTranslator.format.markdown.translateCodeComments": false
}
```

当前实现默认 provider 是 `openai-responses`。用户需要在可视化设置面板中配置当前 provider 的 endpoint、model 和 API key，也可以切换到 Anthropic、Gemini、OpenAI-compatible、DeepL、Google 或 Microsoft。

VS Code 插件提供 `Doc Translator: Open Settings` 可视化设置面板。普通设置写入 VS Code configuration，API key 写入 VS Code `SecretStorage`，用户不需要直接编辑 `settings.json`。

Target language selection is controlled by a fixed extension language dictionary and rendered as an alphabetically sorted dropdown in the visual settings panel. This avoids sending arbitrary target language strings to traditional machine translation providers.

`docTranslator.output.directoryMode` 当前支持：

- `same-dir`：默认模式，译文作为可见普通文件写在源文件旁边。
- `hidden-cache`：译文和 metadata 都写入 `.vscode-doc-translator-cache/`，翻译完成后仍可由 VS Code 直接打开。

Secrets：

- VS Code 插件使用 VS Code `SecretStorage` 保存 provider secret。
- metadata 和日志永远不保存 secret。

## 10. 错误处理

错误信息必须可行动：

- provider credential 缺失。
- 文件类型不支持。
- 翻译过程中源文件发生变化。
- provider rate limit 或 quota error。
- provider 返回格式错误。
- protected syntax 在翻译后被破坏。
- 输出文件已存在。
- 已存在的译文看起来被用户编辑过。

部分失败时，只有在 partial artifact 对用户有用时才写入带 `partial` 状态的 metadata。否则不要留下看起来像完成品的误导性文件。

## 11. 安全与隐私

- 翻译会把文档内容发送给用户选择的 provider。VS Code UI 必须明确提示这一点。
- 插件可支持 workspace 级默认 provider，但 secrets 应保持用户级存储。
- 日志和 metadata 默认不保存原文内容，除非用户显式打开 debug 设置。
- debug 日志必须脱敏 secret。
- 所有用户路径写入前需要 normalize；默认写入范围应限制在源文件目录或显式配置的输出目录内。

## 12. 路线图

### Phase 0：设计与脚手架

- 已完成：确认产品/设计文档。
- 已完成：创建 TypeScript 项目脚手架。
- 已完成：添加共享 core、VS Code extension 和测试设置。

### Phase 1：MVP

- 已完成：Markdown、plain text、MDX、HTML/XML 适配器第一版。
- 已完成：OpenAI Responses、Anthropic Messages、Gemini GenerateContent、OpenAI-compatible、DeepL、Google 和 Microsoft provider 适配器。
- 已完成：传统 MT 使用分段 units；AI/LLM 使用 ordered JSON context 和扁平 JSON 输出。
- 已完成：AI/LLM ordered JSON context 按模型上下文 token 和单次输出 token 构造滑动参考上下文请求并合并结果。
- 已完成：VS Code 命令面板、编辑器右键菜单、Explorer 右键菜单。
- 已完成：VS Code 可视化设置面板。
- 已完成：VS Code 右下角状态栏显示翻译任务状态、进度、缓存命中、成功和失败，并可点击最近译文。
- 已完成：可在设置面板中选择默认翻译 provider 和输出位置。
- 已完成：VS Code diff preview 开关。
- 已完成：同目录译文输出和隐藏 metadata sidecar。
- 已完成：可选 hidden output mode，把译文文件放进隐藏缓存目录。
- 已部分完成：源文档 stale 检测和译文被编辑检测；已编辑译文当前通过 hash 避免缓存复用，覆盖确认 UI 尚未实现。
- 已部分完成：针对命名、metadata、hash、Markdown 抽取/重建、provider contract 的单元测试。

### Phase 2：质量与范围

- 已完成：补齐 Google、DeepL、Microsoft provider 适配器；仍需真实 API 凭据下 live 验证。
- 已部分完成：为 `accurate` profile 添加 LLM review/repair pass；当前已具备 protected-token 校验，自动二次 repair 仍待实现。
- 已完成：支持 term lock，用户可配置不翻译术语。
- 已完成：支持 HTML/XML 和 MDX 适配器第一版。
- 已部分完成：大文件 AI 分块和 provider retry；取消、恢复和更细粒度进度仍待实现。
- 已完成：保存后支持 VS Code source/translation diff preview。

### Phase 3：高级缓存与协作

- Segment-level cache：源文件小改后复用未变化 unit。
- Translation memory 导入/导出。
- 项目级 glossary 文件。
- Workspace 状态视图，显示过期翻译。
- 输出模式已支持 same-dir 和 hidden-cache；后续可继续补全输出目录自定义和迁移旧缓存。

## 13. 待确认问题

- Markdown/plain text 之后，最重要的文件类型是什么？
- Segment-level cache 是否默认保存译文文本，还是出于隐私考虑设为 opt-in？
- `accurate` profile 是否要支持“一个 provider 翻译，另一个 provider 复核”？
- Markdown 自动翻译注释头的默认值是否保持关闭，还是在用户第一次翻译 Markdown 时提示选择？
