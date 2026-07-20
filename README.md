<p align="center">
  <img src="assets/icon.png" alt="VSCode Doc Translator icon" width="112" height="112">
</p>

# VSCode Doc Translator

Translate complete documents inside VS Code while preserving supported structure and formatting. The source file is never overwritten: every translation is saved as a separate, normal document with verifiable cache metadata.

English | [简体中文](README.zh-CN.md)

## Open the Visual Settings

This is the recommended first step and the main way to configure the extension:

1. Open the VS Code Command Palette with `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS.
2. Run `Doc Translator: Open Settings`.
3. Select a provider and a target language.
4. Enter the provider model, endpoint, and API key when required.
5. Select `Save`.

API keys are stored in VS Code SecretStorage. You normally do not need to edit `settings.json`.

## Translate a Document

- Open a document and run `Doc Translator: Translate Current Document` from the Command Palette.
- Right-click inside an editor and select `Doc Translator: Translate Current Document`.
- Right-click a file in Explorer and select `Doc Translator: Translate Document`.

Translation progress appears in the status bar. When complete, the extension can open the translated file or show a source/translation diff.

## Features

- Whole-document translation from the editor, Explorer, or Command Palette.
- Native OpenAI Responses, Anthropic Messages, and Gemini GenerateContent API adapters.
- OpenAI-compatible Chat Completions support for compatible services and local gateways.
- AI quality checks retry source-text echoes once and stop without writing a misleading translation if the repair also fails.
- AI protected-content recovery accepts preserved tokens, harmless Markdown escaping, or unchanged code/URL values. It retries affected units once; if a token still cannot be recovered, only that unit stays in the source language and the translated document is still created with a warning.
- DeepL, Google Cloud Translation, and Microsoft Translator adapters.
- Alphabetically sorted target-language selector with provider-specific language-code mapping.
- Structure-aware Markdown, MDX, HTML/XML, and plain-text processing.
- Protected code, links, markup, and configured terminology where supported by the format adapter.
- Hash-verified cache reuse without overwriting the source or an edited translation.
- Optional cleanup of older, unedited auto-translated files after a cache miss.
- API keys stored separately in VS Code SecretStorage.

## Providers

| Provider | API | Default endpoint |
| --- | --- | --- |
| OpenAI | Responses API with JSON Schema structured output | `https://api.openai.com/v1` |
| Anthropic | Messages API with structured output | `https://api.anthropic.com` |
| Gemini | GenerateContent API with `responseJsonSchema` | `https://generativelanguage.googleapis.com/v1beta` |
| OpenAI-compatible | Chat Completions with JSON output | `https://api.openai.com/v1` |
| DeepL | Text Translation API | `https://api-free.deepl.com` |
| Google Cloud | Translation Basic API | `https://translation.googleapis.com` |
| Microsoft | Azure AI Translator | `https://api.cognitive.microsofttranslator.com` |

For AI providers, enter a model that is available to your account. Model names are intentionally not hard-coded because availability differs by account, region, and endpoint.

Official setup resources: [OpenAI API](https://platform.openai.com/docs/overview), [Anthropic API](https://platform.claude.com/docs/en/api/overview), [Gemini API](https://ai.google.dev/gemini-api/docs), [DeepL API](https://developers.deepl.com/docs), [Google Cloud Translation](https://cloud.google.com/translate/docs), and [Microsoft Translator](https://learn.microsoft.com/azure/ai-services/translator/).

## Supported Files

| Format | Extensions | Behavior |
| --- | --- | --- |
| Markdown | `.md`, `.markdown` | Translates prose while protecting common code, link, image, frontmatter, and table syntax. |
| MDX | `.mdx` | Preserves import/export and JSX structure conservatively while translating Markdown text. |
| HTML/XML | `.html`, `.htm`, `.xml` | Translates text nodes and skips `script` and `style` content. |
| Plain text | `.txt`, extensionless files, fallback | Translates paragraph-like text while preserving whitespace and line endings. |

Binary office documents and PDFs are not supported.

## Output and Cache

With the default `same-dir` output mode, translating `guide.md` creates files similar to:

```text
guide.md
guide.auto.zh-CN.20260720T101530Z.md
.vscode-doc-translator-cache/
  guide.auto.zh-CN.20260720T101530Z.src-2c26b46b.dst-a3f9d9e1.meta.json
```

The translated document remains a normal editable file. Metadata is stored under `.vscode-doc-translator-cache/` next to the source. In `hidden-cache` mode, both the translation and metadata are stored in that directory.

A cached result is reused only when its source hash, target language, provider profile, output mode, and translated-file hash still match. For AI providers, the profile includes the model, endpoint, token budgets, and translation harness version, so changing any of them starts a new translation. If a translated file has been edited, it is preserved and is not treated as an unchanged cache artifact.

`docTranslator.cache.deleteStaleAutoTranslations` is disabled by default. When enabled, older auto translations are deleted only when their current hash still matches their recorded metadata; manually edited translations are kept.

## Settings

All common settings are available through `Doc Translator: Open Settings`.

| Setting | Default | Purpose |
| --- | --- | --- |
| `docTranslator.defaultProvider` | `openai-responses` | Translation provider used by commands. |
| `docTranslator.defaultTargetLanguage` | `zh-CN` | Target language selected from the visual dropdown. |
| `docTranslator.output.directoryMode` | `same-dir` | Save beside the source or inside the hidden cache. |
| `docTranslator.output.openAfterTranslate` | `true` | Open the translated file after completion. |
| `docTranslator.output.showDiffAfterTranslate` | `false` | Show a source/translation diff instead. |
| `docTranslator.termLocks` | `[]` | Terms that must remain unchanged. |
| `docTranslator.cache.deleteStaleAutoTranslations` | `false` | Remove older unedited auto translations after successful retranslation. |
| `docTranslator.llm.maxContextTokens` | `128000` | Context budget used to split AI requests. |
| `docTranslator.llm.maxOutputTokens` | `4096` | Maximum output requested from each AI call. |

Provider-specific endpoint and model settings are shown only for the provider selected in the visual settings panel.

## Privacy and Safety

Document content is sent to the provider you select. Review that provider's data policy before translating sensitive material.

- Source documents are never overwritten.
- API keys are not written to translated files, metadata, cache files, or normal logs.
- Edited translated files are not silently overwritten or deleted.
- Final document reconstruction is performed locally by the format adapter.

## Limitations

- Format adapters are syntax-aware but cannot preserve every unusual Markdown, MDX, HTML, or XML construct perfectly.
- AI token budgeting is approximate and does not use a provider-specific tokenizer.
- Live behavior still depends on your credentials, model access, endpoint compatibility, account region, and provider quotas.
- Cancellation, resume, segment-level cache, and automated Extension Host smoke tests are not yet available.

Issues and feature requests are welcome in the [GitHub issue tracker](https://github.com/G-TTYg/vscode-doc-translator/issues).

## License

[MIT](LICENSE)
