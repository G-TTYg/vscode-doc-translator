# VS Code Doc Translator

Translate whole documents from VS Code or the command line while preserving supported document structure as much as possible.

VS Code Doc Translator creates a translated copy of your document, keeps the original untouched, and writes verifiable metadata beside the source file. It is designed for quick document translation inside a developer workflow, with provider adapters for OpenAI-compatible LLM APIs, DeepL, Google Cloud Translation, and Microsoft Translator.

> Preview status: version 0.1.0 includes the first working VS Code extension, CLI, cache model, format adapters, and provider adapters. External provider adapters require your own credentials and should be validated against your chosen live API before production use.

## Features

- Translate the active editor document from the Command Palette or editor context menu.
- Translate a file from the Explorer context menu.
- Run the same translation workflow from the CLI.
- Preserve structure for supported text formats through format adapters instead of raw full-file replacement.
- Save translated files next to the source document by default, or keep them inside a hidden cache directory.
- Reuse fresh translations when the source file, target language, provider, output mode, and translated artifact hash still match.
- Track translation progress in the VS Code status bar.
- Open the translated file automatically, or open a source/translation diff after translation.
- Configure provider, target language, output mode, term locks, endpoints, and API keys from a settings webview.
- Keep provider secrets out of metadata and cache files.

## Open The Visual Settings Panel

The recommended first step is to open the built-in settings panel:

1. Open the VS Code Command Palette with `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS.
2. Run `Doc Translator: Open Settings`.
3. Choose your translation provider, target language, output location, and provider endpoints.
4. Paste provider API keys into the password fields when needed. Keys are stored in VS Code SecretStorage.
5. Click `Save`.

This visual panel is the main place to configure Doc Translator. You normally do not need to edit `settings.json` manually.

## Supported File Types

| Format | Extensions | Current behavior |
| --- | --- | --- |
| Markdown | `.md`, `.markdown` | Translates prose while protecting common Markdown structure such as code blocks, inline code, links, images, frontmatter, and table syntax. |
| MDX | `.mdx` | First-pass conservative adapter that skips import/export/JSX structure lines and translates Markdown text nodes. |
| HTML/XML | `.html`, `.htm`, `.xml` | Translates text nodes and skips `script` and `style` content. |
| Plain text | `.txt`, extensionless files, fallback | Translates paragraph-like text while preserving surrounding whitespace and line endings. |

Binary office formats and PDFs are intentionally out of scope for the first release.

## Translation Providers

| Provider ID | Use case | Credential source |
| --- | --- | --- |
| `openai-compatible` | OpenAI-compatible chat/completions endpoints that can return structured JSON. | VS Code SecretStorage, CLI argument, or `DOC_TRANSLATOR_OPENAI_API_KEY`. |
| `deepl` | DeepL API translation. | VS Code SecretStorage, CLI argument, or `DOC_TRANSLATOR_DEEPL_API_KEY`. |
| `google` | Google Cloud Translation API. | VS Code SecretStorage, CLI argument, or `DOC_TRANSLATOR_GOOGLE_API_KEY`. |
| `microsoft` | Microsoft Translator / Azure AI Translator. | VS Code SecretStorage, CLI argument, or `DOC_TRANSLATOR_MICROSOFT_API_KEY`. |

Traditional machine translation providers receive segmented translation units. OpenAI-compatible LLM providers receive an ordered JSON reference document with stable unit IDs and must return one flat JSON item for every requested unit ID. If the model wraps JSON in prose or Markdown fences, the provider tries to recover the JSON object; if the model omits an ID, the provider retries only the missing units. If a unit should remain unchanged, the model can return `{ "id": "...", "skip": true }` instead of omitting it. Final document reconstruction always stays inside the format adapter.

## Quick Start

1. Install the extension in VS Code.
2. Open the Command Palette with `Ctrl+Shift+P` or `Cmd+Shift+P`, then run `Doc Translator: Open Settings`.
3. Choose a provider and target language.
4. For a real provider, enter the required API key in the settings panel. Keys are stored in VS Code SecretStorage.
5. Open a local document and run `Doc Translator: Translate Current Document`.

You can also right-click a file in the Explorer and choose `Doc Translator: Translate Document`.

The default provider is `openai-compatible`. Configure an endpoint, model, and API key in the settings panel before translating with it, or switch to `deepl`, `google`, or `microsoft`.

## Output And Cache

By default, translating `guide.md` to Simplified Chinese creates a visible translated file next to the source:

```text
guide.md
guide.auto.zh-CN.20260713T150245Z.md
.vscode-doc-translator-cache/
  guide.auto.zh-CN.20260713T150245Z.src-2c26b46b.dst-a3f9d9e1.meta.json
```

If `docTranslator.output.directoryMode` is set to `hidden-cache`, both the translated file and metadata sidecar are written inside `.vscode-doc-translator-cache/`.

Cache reuse is hash-based. A cached translation is reused only when the source hash, target language, provider, output mode, and translated file hash still match. If the source file changes, a new translated artifact is created. If the translated artifact was edited, the extension avoids treating it as a fresh cache hit.

## VS Code Settings

Most settings can be changed from the visual panel opened by `Doc Translator: Open Settings`.

| Setting | Default | Description |
| --- | --- | --- |
| `docTranslator.defaultTargetLanguage` | `zh-CN` | Target language used by VS Code commands. |
| `docTranslator.defaultProvider` | `openai-compatible` | Provider ID: `openai-compatible`, `deepl`, `google`, or `microsoft`. |
| `docTranslator.output.directoryMode` | `same-dir` | `same-dir` writes translated files beside the source; `hidden-cache` writes them into the cache directory. |
| `docTranslator.output.openAfterTranslate` | `true` | Open the translated file after translation. |
| `docTranslator.output.showDiffAfterTranslate` | `false` | Open a VS Code diff between the source and translated files. |
| `docTranslator.termLocks` | `[]` | Terms that must remain untranslated. |
| `docTranslator.cache.hiddenDirectoryName` | `.vscode-doc-translator-cache` | Metadata/cache directory written next to the source document. |
| `docTranslator.llm.endpoint` | `https://api.openai.com/v1` | OpenAI-compatible API base URL. |
| `docTranslator.llm.model` | empty | Model name for the OpenAI-compatible provider. |
| `docTranslator.llm.maxContextTokens` | `128000` | Model context budget used for LLM request chunking. |
| `docTranslator.llm.maxOutputTokens` | `4096` | Maximum response tokens requested per LLM call. |
| `docTranslator.deepl.endpoint` | `https://api-free.deepl.com` | DeepL API base URL. |
| `docTranslator.google.endpoint` | `https://translation.googleapis.com` | Google Cloud Translation API base URL. |
| `docTranslator.microsoft.endpoint` | `https://api.cognitive.microsofttranslator.com` | Microsoft Translator API base URL. |
| `docTranslator.microsoft.region` | empty | Microsoft Translator region, when required by the resource. |
| `docTranslator.markdown.insertAutoTranslationHeader` | `false` | Insert a short auto-translation comment in Markdown outputs. |

## CLI Usage

The CLI uses the same core translation pipeline as the VS Code extension.

```bash
vscode-doc-translator translate ./guide.md --to zh-CN --provider openai-compatible
```

When running from a local build:

```bash
node dist/cli/main.js translate ./guide.md --to zh-CN --provider openai-compatible
node dist/cli/main.js translate ./guide.md --to zh-CN --provider openai-compatible --output hidden-cache
```

OpenAI-compatible example:

```bash
set DOC_TRANSLATOR_OPENAI_API_KEY=...
set DOC_TRANSLATOR_OPENAI_MODEL=...
set DOC_TRANSLATOR_OPENAI_ENDPOINT=https://api.openai.com/v1
node dist/cli/main.js translate ./guide.md --to zh-CN --provider openai-compatible
```

Large LLM documents can be chunked with explicit token budgets:

```bash
node dist/cli/main.js translate ./guide.md --to zh-CN --provider openai-compatible --llm-max-context-tokens 128000 --llm-max-output-tokens 4096
```

Other provider environment variables:

```bash
set DOC_TRANSLATOR_DEEPL_API_KEY=...
set DOC_TRANSLATOR_GOOGLE_API_KEY=...
set DOC_TRANSLATOR_MICROSOFT_API_KEY=...
set DOC_TRANSLATOR_MICROSOFT_REGION=...
```

Useful CLI options:

```text
--from auto
--to zh-CN
--provider openai-compatible|deepl|google|microsoft
--output same-dir|hidden-cache
--term-locks OpenAI,VS Code
--force
--json
--insert-markdown-header
```

## Privacy And Security

Document content is sent to the provider you choose. Review your provider's data policy before translating sensitive documents.

API keys and bearer tokens are not written to metadata, cache files, or normal logs. In VS Code, provider keys are stored in SecretStorage. In the CLI, prefer environment variables over command-line arguments when possible.

## Known Limitations

- DeepL, Google, Microsoft, and OpenAI-compatible adapters are implemented, but live API behavior depends on your credentials, endpoint, region, model, and provider compatibility.
- The Markdown and MDX adapters are first-pass syntax-aware adapters, not full-fidelity parsers for every edge case.
- LLM token budgeting uses an approximation rather than a provider-specific tokenizer.
- Very large individual translation units may still exceed an input or output budget.
- Cancellation, resume, segment-level cache, and extension-host automated smoke tests are planned future work.
