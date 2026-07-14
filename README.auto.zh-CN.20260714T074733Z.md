<!-- Auto-translated by VSCode Doc Translator. Metadata is stored in .vscode-doc-translator-cache. -->

# VS Code 文档翻译器

从 VS Code 或命令行翻译整个文档，同时尽可能保留受支持的文档结构。

VS Code 文档翻译器会创建文档的翻译副本，保持原文不变，并在源文件旁写入可验证的元数据。它专为开发者工作流中的快速文档翻译而设计，提供适用于 OpenAI 兼容 LLM API、DeepL、Google Cloud Translation、Microsoft Translator 的提供商适配器，以及用于冒烟测试的本地 fake 提供商。

> 预览状态：版本 0.1.0 包含首个可用的 VS Code 扩展、CLI、缓存模型、格式适配器和提供商适配器。外部提供商适配器需要使用你自己的凭据，并且在投入生产前应针对你选择的实时 API 进行验证。

## 功能

- 从命令面板或编辑器上下文菜单翻译当前编辑器文档。
- 从资源管理器上下文菜单翻译文件。
- 从 CLI 运行相同的翻译工作流。
- 通过格式适配器而不是原始的整文件替换，为受支持的文本格式保留结构。
- 默认将翻译文件保存到源文档旁，或将其保存在隐藏缓存目录中。
- 当源文件、目标语言、提供商、输出模式和翻译产物哈希仍然匹配时，复用新鲜的翻译结果。
- 在 VS Code 状态栏中跟踪翻译进度。
- 自动打开翻译文件，或在翻译后打开源文件与翻译文件的差异视图。
- 从设置 Webview 配置提供商、目标语言、输出模式、术语锁定、端点和 API 密钥。
- 避免将提供商机密信息写入元数据和缓存文件。

## 打开可视化设置面板

建议首先打开内置设置面板：

1. 打开 VS Code 命令面板，在 Windows/Linux 上使用 `Ctrl+Shift+P`，在 macOS 上使用 `Cmd+Shift+P`。
2. 运行 `Doc Translator: Open Settings`。
3. 选择翻译提供商、目标语言、输出位置和提供商端点。
4. 需要时，将提供商 API 密钥粘贴到密码字段中。密钥会存储在 VS Code SecretStorage 中。
5. 点击 `Save`。

此可视化面板是配置 Doc Translator 的主要位置。通常不需要手动编辑 `settings.json`。

## 支持的文件类型

| 格式 | 扩展名 | 当前行为 |
| --- | --- | --- |
| Markdown | `.md`、`.markdown` | 翻译正文，同时保护常见的 Markdown 结构，例如代码块、行内代码、链接、图像、frontmatter 和表格语法。 |
| MDX | `.mdx` | 首个保守型适配器会跳过 import/export/JSX 结构行，并翻译 Markdown 文本节点。 |
| HTML/XML | `.html`、`.htm`、`.xml` | 翻译文本节点，并跳过 `script` 和 `style` 内容。 |
| 纯文本 | `.txt`、无扩展名文件、回退格式 | 翻译类似段落的文本，同时保留周围的空白和换行符。 |

二进制办公格式和 PDF 有意不在首个版本的范围内。

## 翻译提供商

| 提供商 ID | 使用场景 | 凭据来源 |
| --- | --- | --- |
| `fake` | 无需外部网络调用的本地冒烟测试和演示。 | 无。 |
| `openai-compatible` | 能够返回结构化 JSON 的 OpenAI 兼容聊天/补全端点。 | VS Code SecretStorage、CLI 参数或 `DOC_TRANSLATOR_OPENAI_API_KEY`。 |
| `deepl` | DeepL API 翻译。 | VS Code SecretStorage、CLI 参数或 `DOC_TRANSLATOR_DEEPL_API_KEY`。 |
| `google` | Google Cloud Translation API。 | VS Code SecretStorage、CLI 参数或 `DOC_TRANSLATOR_GOOGLE_API_KEY`。 |
| `microsoft` | Microsoft Translator / Azure AI Translator。 | VS Code SecretStorage、CLI 参数或 `DOC_TRANSLATOR_MICROSOFT_API_KEY`。 |

传统机器翻译提供商接收分段的翻译单元。OpenAI 兼容的 LLM 提供商接收包含稳定单元 ID 的有序 JSON 参考文档，并且必须返回一个由已翻译单元 ID 组成的扁平 JSON 列表。最终文档重建始终在格式适配器内部完成。

## 快速开始

1. 在 VS Code 中安装扩展。
2. 使用 `Ctrl+Shift+P` 或 `Cmd+Shift+P` 打开命令面板，然后运行 `Doc Translator: Open Settings`。
3. 选择提供商和目标语言。
4. 对于真实提供商，在设置面板中输入所需的 API 密钥。密钥会存储在 VS Code SecretStorage 中。
5. 打开本地文档并运行 `Doc Translator: Translate Current Document`。

你也可以在资源管理器中右键点击文件，然后选择 `Doc Translator: Translate Document`。

默认提供商是 `fake`，因此无需凭据即可立即测试扩展。要进行真实翻译，请切换到 `openai-compatible`、`deepl`、`google` 或 `microsoft`。

## 输出与缓存

默认情况下，将 `guide.md` 翻译为简体中文会在源文件旁创建一个可见的翻译文件：

```text
guide.md
guide.auto.zh-CN.20260713T150245Z.md
.vscode-doc-translator-cache/
  guide.auto.zh-CN.20260713T150245Z.src-2c26b46b.dst-a3f9d9e1.meta.json
```

如果将 `docTranslator.output.directoryMode` 设置为 `hidden-cache`，翻译文件和元数据附属文件都会写入 `.vscode-doc-translator-cache/`。

缓存复用基于哈希。只有当源哈希、目标语言、提供商、输出模式和翻译文件哈希仍然匹配时，才会复用缓存的翻译。如果源文件发生变化，就会创建新的翻译产物。如果翻译产物被编辑，扩展会避免将其视为新鲜的缓存命中。

## VS Code 设置

大多数设置都可以从通过 `Doc Translator: Open Settings` 打开的可视化面板中修改。

| 设置 | 默认值 | 描述 |
| --- | --- | --- |
| `docTranslator.defaultTargetLanguage` | `zh-CN` | VS Code 命令使用的目标语言。 |
| `docTranslator.defaultProvider` | `fake` | 提供商 ID：`fake`、`openai-compatible`、`deepl`、`google` 或 `microsoft`。 |
| `docTranslator.output.directoryMode` | `same-dir` | `same-dir` 将翻译文件写入源文件旁；`hidden-cache` 将其写入缓存目录。 |
| `docTranslator.output.openAfterTranslate` | `true` | 翻译后打开翻译文件。 |
| `docTranslator.output.showDiffAfterTranslate` | `false` | 打开源文件与翻译文件之间的 VS Code 差异视图。 |
| `docTranslator.termLocks` | `[]` | 必须保持不翻译的术语。 |
| `docTranslator.cache.hiddenDirectoryName` | `.vscode-doc-translator-cache` | 写入源文档旁的元数据/缓存目录。 |
| `docTranslator.llm.endpoint` | `https://api.openai.com/v1` | OpenAI 兼容 API 基础 URL。 |
| `docTranslator.llm.model` | 空 | OpenAI 兼容提供商的模型名称。 |
| `docTranslator.llm.maxContextTokens` | `128000` | 用于 LLM 请求分块的模型上下文预算。 |
| `docTranslator.llm.maxOutputTokens` | `4096` | 每次 LLM 调用请求的最大响应令牌数。 |
| `docTranslator.deepl.endpoint` | `https://api-free.deepl.com` | DeepL API 基础 URL。 |
| `docTranslator.google.endpoint` | `https://translation.googleapis.com` | Google Cloud Translation API 基础 URL。 |
| `docTranslator.microsoft.endpoint` | `https://api.cognitive.microsofttranslator.com` | Microsoft Translator API 基础 URL。 |
| `docTranslator.microsoft.region` | 空 | 资源所需时使用的 Microsoft Translator 区域。 |
| `docTranslator.markdown.insertAutoTranslationHeader` | `false` | 在 Markdown 输出中插入简短的自动翻译注释。 |

## CLI 用法

CLI 使用与 VS Code 扩展相同的核心翻译管道。

```bash
vscode-doc-translator translate ./guide.md --to zh-CN --provider fake
```

从本地构建运行时：

```bash
node dist/cli/main.js translate ./guide.md --to zh-CN --provider fake
node dist/cli/main.js translate ./guide.md --to zh-CN --provider fake --output hidden-cache
```

OpenAI 兼容示例：

```bash
set DOC_TRANSLATOR_OPENAI_API_KEY=...
set DOC_TRANSLATOR_OPENAI_MODEL=...
set DOC_TRANSLATOR_OPENAI_ENDPOINT=https://api.openai.com/v1
node dist/cli/main.js translate ./guide.md --to zh-CN --provider openai-compatible
```

大型 LLM 文档可以使用明确的令牌预算进行分块：

```bash
node dist/cli/main.js translate ./guide.md --to zh-CN --provider openai-compatible --llm-max-context-tokens 128000 --llm-max-output-tokens 4096
```

其他提供商环境变量：

```bash
set DOC_TRANSLATOR_DEEPL_API_KEY=...
set DOC_TRANSLATOR_GOOGLE_API_KEY=...
set DOC_TRANSLATOR_MICROSOFT_API_KEY=...
set DOC_TRANSLATOR_MICROSOFT_REGION=...
```

有用的 CLI 选项：

```text
--from auto
--to zh-CN
--provider fake|openai-compatible|deepl|google|microsoft
--output same-dir|hidden-cache
--term-locks OpenAI,VS Code
--force
--json
--insert-markdown-header
```

## 隐私与安全

除使用本地 `fake` 提供商外，文档内容会发送给你选择的提供商。在翻译敏感文档前，请查看提供商的数据政策。

API 密钥和 bearer 令牌不会写入元数据、缓存文件或普通日志。在 VS Code 中，提供商密钥存储在 SecretStorage 中。在 CLI 中，尽可能优先使用环境变量，而不是命令行参数。

## 已知限制

- DeepL、Google、Microsoft 和 OpenAI 兼容适配器已经实现，但实时 API 行为取决于你的凭据、端点、区域、模型和提供商兼容性。
- Markdown 和 MDX 适配器是首个具备语法感知能力的适配器，并非针对所有边界情况的高保真解析器。
- LLM 令牌预算使用近似值，而不是特定于提供商的分词器。
- 非常大的单个翻译单元仍可能超出输入或输出预算。
- 取消、恢复、分段级缓存和扩展宿主自动化冒烟测试计划作为未来工作实现。

## 开发

要求：

- VS Code 1.90 或更高版本。
- Node.js 20 或更高版本。

安装、构建、测试和打包：

```bash
npm install
npm run compile
npm test
npm run check
npm run package:vsix
```

编译后，使用 `Run Extension` 启动配置在本地运行扩展。

打包命令会生成：

```text
vscode-doc-translator-0.1.0.vsix
```

## 架构说明

项目将 VS Code UI、CLI 解析、应用工作流、格式适配器、提供商适配器以及元数据/缓存存储分离开来。共享核心位于 `src/core/` 下，并由 `src/extension/` 和 `src/cli/` 使用。

如需了解更深入的实现细节，请参阅：

- `docs/design.md`
- `docs/architecture.md`
- `docs/adr/`
