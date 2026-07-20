<p align="center">
  <img src="assets/icon.png" alt="VSCode Doc Translator 图标" width="112" height="112">
</p>

# VSCode Doc Translator

在 VS Code 中翻译整份文档，并尽量保留受支持的结构与格式。插件永远不会覆盖源文件，而是生成独立的普通文档，并使用可校验的缓存元数据记录翻译状态。

[English](README.md) | 简体中文

## 打开可视化设置

这是安装后最重要的第一步，也是推荐的配置方式：

1. 在 Windows/Linux 上按 `Ctrl+Shift+P`，在 macOS 上按 `Cmd+Shift+P`，打开 VS Code 命令面板。
2. 运行 `Doc Translator: Open Settings`。
3. 选择翻译服务和目标语言。
4. 按需填写模型、接口地址和 API Key。
5. 点击 `Save`。

API Key 保存在 VS Code SecretStorage 中。通常不需要手动编辑 `settings.json`。

## 翻译文档

- 打开文档，在命令面板运行 `Doc Translator: Translate Current Document`。
- 在编辑器中右键，选择 `Doc Translator: Translate Current Document`。
- 在资源管理器中右键文件，选择 `Doc Translator: Translate Document`。

翻译进度会显示在状态栏。完成后，插件可以直接打开译文，或显示原文与译文的差异视图。

## 功能

- 从编辑器、资源管理器或命令面板翻译整份文档。
- 原生支持 OpenAI Responses、Anthropic Messages 和 Gemini GenerateContent API。
- 支持 OpenAI-compatible Chat Completions 接口和本地兼容网关。
- AI 质量检查会对大面积原文回显定向重试一次；修复仍失败时停止并且不写入误导性的“译文”。
- 支持 DeepL、Google Cloud Translation 和 Microsoft Translator。
- 目标语言下拉列表按字母顺序排列，并自动转换不同供应商的语言代码。
- 支持 Markdown、MDX、HTML/XML 和纯文本的结构化处理。
- 尽量保护代码、链接、标记语法和用户锁定术语。
- 使用哈希校验缓存，不覆盖源文件和用户编辑过的译文。
- 可选清理缓存失效后遗留的旧版、未编辑自动译文。
- API Key 独立保存在 VS Code SecretStorage 中。

## 翻译服务

| 服务 | 接口 | 默认地址 |
| --- | --- | --- |
| OpenAI | Responses API，使用 JSON Schema 结构化输出 | `https://api.openai.com/v1` |
| Anthropic | Messages API，使用结构化输出 | `https://api.anthropic.com` |
| Gemini | GenerateContent API，使用 `responseJsonSchema` | `https://generativelanguage.googleapis.com/v1beta` |
| OpenAI-compatible | Chat Completions JSON 输出 | `https://api.openai.com/v1` |
| DeepL | Text Translation API | `https://api-free.deepl.com` |
| Google Cloud | Translation Basic API | `https://translation.googleapis.com` |
| Microsoft | Azure AI Translator | `https://api.cognitive.microsofttranslator.com` |

AI 服务需要填写当前账号可用的模型名称。插件不固定默认模型，因为模型可用性会随账号、地区和接口地址而变化。

官方配置文档：[OpenAI API](https://platform.openai.com/docs/overview)、[Anthropic API](https://platform.claude.com/docs/en/api/overview)、[Gemini API](https://ai.google.dev/gemini-api/docs)、[DeepL API](https://developers.deepl.com/docs)、[Google Cloud Translation](https://cloud.google.com/translate/docs) 和 [Microsoft Translator](https://learn.microsoft.com/azure/ai-services/translator/)。

## 支持的文件

| 格式 | 扩展名 | 当前行为 |
| --- | --- | --- |
| Markdown | `.md`、`.markdown` | 翻译正文，并保护常见代码、链接、图片、frontmatter 和表格语法。 |
| MDX | `.mdx` | 保守保留 import/export 与 JSX 结构，翻译 Markdown 文本。 |
| HTML/XML | `.html`、`.htm`、`.xml` | 翻译文本节点，跳过 `script` 和 `style` 内容。 |
| 纯文本 | `.txt`、无扩展名文件、回退格式 | 翻译段落文本，保留空白和换行符。 |

暂不支持二进制 Office 文档和 PDF。

## 输出与缓存

默认使用 `same-dir` 模式。翻译 `guide.md` 后会生成类似文件：

```text
guide.md
guide.auto.zh-CN.20260720T101530Z.md
.vscode-doc-translator-cache/
  guide.auto.zh-CN.20260720T101530Z.src-2c26b46b.dst-a3f9d9e1.meta.json
```

译文是可以正常编辑的普通文件，元数据保存在源文件旁的 `.vscode-doc-translator-cache/` 中。选择 `hidden-cache` 模式后，译文和元数据都会保存在该目录。

只有当源文件哈希、目标语言、服务配置、输出模式和译文哈希都匹配时，插件才会复用缓存。AI 服务配置包含模型、接口地址、token 预算和翻译 harness 版本；修改其中任意一项都会重新翻译。如果译文已被手动编辑，插件会保留它，也不会把它视为未修改缓存。

`docTranslator.cache.deleteStaleAutoTranslations` 默认关闭。启用后，插件只会删除当前哈希仍与元数据一致的旧自动译文；手动编辑过的译文始终保留。

## 常用设置

所有常用设置都可以通过 `Doc Translator: Open Settings` 修改。

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| `docTranslator.defaultProvider` | `openai-responses` | 命令使用的翻译服务。 |
| `docTranslator.defaultTargetLanguage` | `zh-CN` | 从可视化下拉列表选择的目标语言。 |
| `docTranslator.output.directoryMode` | `same-dir` | 将译文保存在源文件旁或隐藏缓存目录中。 |
| `docTranslator.output.openAfterTranslate` | `true` | 完成后打开译文。 |
| `docTranslator.output.showDiffAfterTranslate` | `false` | 改为显示原文/译文差异。 |
| `docTranslator.termLocks` | `[]` | 必须保持不变的术语。 |
| `docTranslator.cache.deleteStaleAutoTranslations` | `false` | 成功重新翻译后删除旧的未编辑自动译文。 |
| `docTranslator.llm.maxContextTokens` | `128000` | AI 请求分块使用的上下文预算。 |
| `docTranslator.llm.maxOutputTokens` | `4096` | 每次 AI 请求允许的最大输出。 |

可视化设置面板只显示当前所选服务对应的端点、模型和密钥字段。

## 隐私与安全

文档内容会发送给你选择的翻译服务。翻译敏感文档前，请先确认该服务的数据政策。

- 永远不覆盖源文档。
- API Key 不会写入译文、元数据、缓存或普通日志。
- 不会静默覆盖或删除用户编辑过的译文。
- 最终文档由本地格式适配器重建。

## 已知限制

- 格式适配器能够识别常见语法，但无法完美保留所有特殊 Markdown、MDX、HTML 或 XML 写法。
- AI token 预算使用近似估算，不依赖供应商专用 tokenizer。
- 实际调用仍取决于密钥、模型权限、接口兼容性、账号地区和服务配额。
- 暂不支持取消、断点续传、分段缓存和自动化 Extension Host 冒烟测试。

欢迎在 [GitHub Issues](https://github.com/G-TTYg/vscode-doc-translator/issues) 提交问题和功能建议。

## 许可证

[MIT](LICENSE)
