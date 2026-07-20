import * as vscode from "vscode";
import type { OutputDirectoryMode } from "../core/domain/types";
import { normalizeTargetLanguageCode, TARGET_LANGUAGES } from "./targetLanguages";

export const SECRET_KEYS = {
  openAiResponses: "docTranslator.openAiApiKey",
  openAiCompatible: "docTranslator.openaiCompatibleApiKey",
  anthropic: "docTranslator.anthropicApiKey",
  gemini: "docTranslator.geminiApiKey",
  deepl: "docTranslator.deeplApiKey",
  google: "docTranslator.googleApiKey",
  microsoft: "docTranslator.microsoftApiKey"
} as const;

interface SettingsState {
  readonly defaultTargetLanguage: string;
  readonly defaultProvider: string;
  readonly outputDirectoryMode: OutputDirectoryMode;
  readonly openAfterTranslate: boolean;
  readonly showDiffAfterTranslate: boolean;
  readonly cacheDirectoryName: string;
  readonly deleteStaleAutoTranslations: boolean;
  readonly termLocks: readonly string[];
  readonly insertMarkdownHeader: boolean;
  readonly openAiEndpoint: string;
  readonly openAiModel: string;
  readonly llmEndpoint: string;
  readonly llmModel: string;
  readonly llmMaxContextTokens: number;
  readonly llmMaxOutputTokens: number;
  readonly anthropicEndpoint: string;
  readonly anthropicModel: string;
  readonly geminiEndpoint: string;
  readonly geminiModel: string;
  readonly deeplEndpoint: string;
  readonly googleEndpoint: string;
  readonly microsoftEndpoint: string;
  readonly microsoftRegion: string;
  readonly hasOpenAiResponsesKey: boolean;
  readonly hasOpenAiKey: boolean;
  readonly hasAnthropicKey: boolean;
  readonly hasGeminiKey: boolean;
  readonly hasDeepLKey: boolean;
  readonly hasGoogleKey: boolean;
  readonly hasMicrosoftKey: boolean;
}

type SaveSettingsMessage = {
  readonly type: "save";
  readonly values: Partial<SettingsState> & {
    readonly openAiResponsesKey?: string;
    readonly openAiKey?: string;
    readonly anthropicKey?: string;
    readonly geminiKey?: string;
    readonly deeplKey?: string;
    readonly googleKey?: string;
    readonly microsoftKey?: string;
  };
};

type SettingsMessage = SaveSettingsMessage | { readonly type: "ready" };

export async function openSettingsPanel(context: vscode.ExtensionContext): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "docTranslatorSettings",
    "Doc Translator Settings",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  panel.webview.html = renderSettingsHtml(await readSettingsState(context));
  panel.webview.onDidReceiveMessage(
    async (message: SettingsMessage) => {
      if (message.type === "ready") {
        panel.webview.postMessage({ type: "state", state: await readSettingsState(context) });
        return;
      }
      if (message.type === "save") {
        await saveSettingsState(context, message.values);
        const state = await readSettingsState(context);
        panel.webview.html = renderSettingsHtml(state);
        await vscode.window.showInformationMessage("Doc Translator settings saved.");
      }
    },
    undefined,
    context.subscriptions
  );
}

async function readSettingsState(context: vscode.ExtensionContext): Promise<SettingsState> {
  const config = vscode.workspace.getConfiguration("docTranslator");
  return {
    defaultTargetLanguage: normalizeTargetLanguageCode(
      config.get<string>("defaultTargetLanguage", "zh-CN")
    ),
    defaultProvider: config.get<string>("defaultProvider", "openai-responses"),
    outputDirectoryMode: config.get<OutputDirectoryMode>("output.directoryMode", "same-dir"),
    openAfterTranslate: config.get<boolean>("output.openAfterTranslate", true),
    showDiffAfterTranslate: config.get<boolean>("output.showDiffAfterTranslate", false),
    cacheDirectoryName: config.get<string>(
      "cache.hiddenDirectoryName",
      ".vscode-doc-translator-cache"
    ),
    deleteStaleAutoTranslations: config.get<boolean>(
      "cache.deleteStaleAutoTranslations",
      false
    ),
    termLocks: config.get<string[]>("termLocks", []),
    insertMarkdownHeader: config.get<boolean>("markdown.insertAutoTranslationHeader", false),
    openAiEndpoint: config.get<string>("openai.endpoint", "https://api.openai.com/v1"),
    openAiModel: config.get<string>("openai.model", ""),
    llmEndpoint: config.get<string>("llm.endpoint", "https://api.openai.com/v1"),
    llmModel: config.get<string>("llm.model", ""),
    llmMaxContextTokens: config.get<number>("llm.maxContextTokens", 128000),
    llmMaxOutputTokens: config.get<number>("llm.maxOutputTokens", 4096),
    anthropicEndpoint: config.get<string>("anthropic.endpoint", "https://api.anthropic.com"),
    anthropicModel: config.get<string>("anthropic.model", ""),
    geminiEndpoint: config.get<string>(
      "gemini.endpoint",
      "https://generativelanguage.googleapis.com/v1beta"
    ),
    geminiModel: config.get<string>("gemini.model", ""),
    deeplEndpoint: config.get<string>("deepl.endpoint", "https://api-free.deepl.com"),
    googleEndpoint: config.get<string>("google.endpoint", "https://translation.googleapis.com"),
    microsoftEndpoint: config.get<string>(
      "microsoft.endpoint",
      "https://api.cognitive.microsofttranslator.com"
    ),
    microsoftRegion: config.get<string>("microsoft.region", ""),
    hasOpenAiResponsesKey: Boolean(await context.secrets.get(SECRET_KEYS.openAiResponses)),
    hasOpenAiKey: Boolean(await context.secrets.get(SECRET_KEYS.openAiCompatible)),
    hasAnthropicKey: Boolean(await context.secrets.get(SECRET_KEYS.anthropic)),
    hasGeminiKey: Boolean(await context.secrets.get(SECRET_KEYS.gemini)),
    hasDeepLKey: Boolean(await context.secrets.get(SECRET_KEYS.deepl)),
    hasGoogleKey: Boolean(await context.secrets.get(SECRET_KEYS.google)),
    hasMicrosoftKey: Boolean(await context.secrets.get(SECRET_KEYS.microsoft))
  };
}

async function saveSettingsState(
  context: vscode.ExtensionContext,
  values: SaveSettingsMessage["values"]
): Promise<void> {
  const config = vscode.workspace.getConfiguration("docTranslator");
  const target = vscode.ConfigurationTarget.Global;

  await updateIfDefined(
    config,
    "defaultTargetLanguage",
    normalizeTargetLanguageCode(values.defaultTargetLanguage),
    target
  );
  await updateIfDefined(config, "defaultProvider", values.defaultProvider, target);
  await updateIfDefined(config, "output.directoryMode", values.outputDirectoryMode, target);
  await updateIfDefined(config, "output.openAfterTranslate", values.openAfterTranslate, target);
  await updateIfDefined(config, "output.showDiffAfterTranslate", values.showDiffAfterTranslate, target);
  await updateIfDefined(config, "cache.hiddenDirectoryName", values.cacheDirectoryName, target);
  await updateIfDefined(
    config,
    "cache.deleteStaleAutoTranslations",
    values.deleteStaleAutoTranslations,
    target
  );
  await updateIfDefined(config, "termLocks", values.termLocks, target);
  await updateIfDefined(
    config,
    "markdown.insertAutoTranslationHeader",
    values.insertMarkdownHeader,
    target
  );
  await updateIfDefined(config, "openai.endpoint", values.openAiEndpoint, target);
  await updateIfDefined(config, "openai.model", values.openAiModel, target);
  await updateIfDefined(config, "llm.endpoint", values.llmEndpoint, target);
  await updateIfDefined(config, "llm.model", values.llmModel, target);
  await updateIfDefined(config, "llm.maxContextTokens", values.llmMaxContextTokens, target);
  await updateIfDefined(config, "llm.maxOutputTokens", values.llmMaxOutputTokens, target);
  await updateIfDefined(config, "anthropic.endpoint", values.anthropicEndpoint, target);
  await updateIfDefined(config, "anthropic.model", values.anthropicModel, target);
  await updateIfDefined(config, "gemini.endpoint", values.geminiEndpoint, target);
  await updateIfDefined(config, "gemini.model", values.geminiModel, target);
  await updateIfDefined(config, "deepl.endpoint", values.deeplEndpoint, target);
  await updateIfDefined(config, "google.endpoint", values.googleEndpoint, target);
  await updateIfDefined(config, "microsoft.endpoint", values.microsoftEndpoint, target);
  await updateIfDefined(config, "microsoft.region", values.microsoftRegion, target);

  await storeSecretIfPresent(context, SECRET_KEYS.openAiResponses, values.openAiResponsesKey);
  await storeSecretIfPresent(context, SECRET_KEYS.openAiCompatible, values.openAiKey);
  await storeSecretIfPresent(context, SECRET_KEYS.anthropic, values.anthropicKey);
  await storeSecretIfPresent(context, SECRET_KEYS.gemini, values.geminiKey);
  await storeSecretIfPresent(context, SECRET_KEYS.deepl, values.deeplKey);
  await storeSecretIfPresent(context, SECRET_KEYS.google, values.googleKey);
  await storeSecretIfPresent(context, SECRET_KEYS.microsoft, values.microsoftKey);
}

async function updateIfDefined(
  config: vscode.WorkspaceConfiguration,
  key: string,
  value: unknown,
  target: vscode.ConfigurationTarget
): Promise<void> {
  if (value !== undefined) {
    await config.update(key, value, target);
  }
}

async function storeSecretIfPresent(
  context: vscode.ExtensionContext,
  key: string,
  value: string | undefined
): Promise<void> {
  if (value && value.trim().length > 0) {
    await context.secrets.store(key, value.trim());
  }
}

function renderSettingsHtml(state: SettingsState): string {
  const stateJson = escapeHtml(JSON.stringify(state));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Doc Translator Settings</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    body {
      margin: 0;
      padding: 24px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    main {
      max-width: 860px;
      display: grid;
      gap: 22px;
    }
    h1 {
      font-size: 22px;
      font-weight: 600;
      margin: 0;
    }
    h2 {
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 10px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0;
    }
    section {
      display: grid;
      gap: 12px;
      border-top: 1px solid var(--vscode-panel-border);
      padding-top: 18px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
    }
    label {
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    span {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    input, select {
      box-sizing: border-box;
      width: 100%;
      min-height: 30px;
      border: 1px solid var(--vscode-input-border, transparent);
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      padding: 5px 8px;
      border-radius: 4px;
    }
    textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 86px;
      resize: vertical;
      border: 1px solid var(--vscode-input-border, transparent);
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      padding: 6px 8px;
      border-radius: 4px;
      font-family: var(--vscode-font-family);
    }
    input[type="checkbox"] {
      width: 16px;
      min-height: 16px;
      padding: 0;
    }
    .check {
      grid-template-columns: 18px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
    }
    .check span {
      color: var(--vscode-foreground);
      font-size: inherit;
    }
    button {
      justify-self: start;
      border: 0;
      border-radius: 4px;
      padding: 8px 14px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .status {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <main>
    <h1>Doc Translator Settings</h1>
    <form id="settings">
      <section>
        <h2>General</h2>
        <div class="grid">
          <label><span>Provider</span><select name="defaultProvider">
            ${providerOptions(state.defaultProvider)}
          </select></label>
          <label><span>Translated file location</span><select name="outputDirectoryMode">
            ${outputDirectoryModeOptions(state.outputDirectoryMode)}
          </select></label>
          <label><span>Target language</span><select name="defaultTargetLanguage">
            ${targetLanguageOptions(state.defaultTargetLanguage)}
          </select></label>
          <label><span>Cache directory</span><input name="cacheDirectoryName" value="${escapeHtml(
            state.cacheDirectoryName
          )}" /></label>
        </div>
        <label class="check"><input type="checkbox" name="openAfterTranslate" ${
          state.openAfterTranslate ? "checked" : ""
        } /><span>Open translated document</span></label>
        <label class="check"><input type="checkbox" name="showDiffAfterTranslate" ${
          state.showDiffAfterTranslate ? "checked" : ""
        } /><span>Open source/translation diff</span></label>
        <label class="check"><input type="checkbox" name="deleteStaleAutoTranslations" ${
          state.deleteStaleAutoTranslations ? "checked" : ""
        } /><span>Delete old unedited auto translations when cache is stale</span></label>
        <label class="check"><input type="checkbox" name="insertMarkdownHeader" ${
          state.insertMarkdownHeader ? "checked" : ""
        } /><span>Insert Markdown auto-translation header</span></label>
        <label><span>Term locks, one per line</span><textarea name="termLocks">${escapeHtml(
          state.termLocks.join("\n")
        )}</textarea></label>
      </section>
      <section class="ai-limits">
        <h2>AI request limits</h2>
        <div class="grid">
          <label><span>Model max context tokens</span><input type="number" min="1000" step="1000" name="llmMaxContextTokens" value="${
            state.llmMaxContextTokens
          }" /></label>
          <label><span>Max output tokens</span><input type="number" min="256" step="256" name="llmMaxOutputTokens" value="${
            state.llmMaxOutputTokens
          }" /></label>
        </div>
      </section>
      <section class="provider-section" data-provider="openai-responses">
        <h2>OpenAI Responses API</h2>
        <div class="grid">
          <label><span>Endpoint</span><input name="openAiEndpoint" value="${escapeHtml(
            state.openAiEndpoint
          )}" /></label>
          <label><span>Model</span><input name="openAiModel" value="${escapeHtml(
            state.openAiModel
          )}" placeholder="Enter a model name" /></label>
          <label><span>API key ${state.hasOpenAiResponsesKey ? "(saved)" : ""}</span><input type="password" name="openAiResponsesKey" autocomplete="off" /></label>
        </div>
      </section>
      <section class="provider-section" data-provider="anthropic">
        <h2>Anthropic Messages API</h2>
        <div class="grid">
          <label><span>Endpoint</span><input name="anthropicEndpoint" value="${escapeHtml(
            state.anthropicEndpoint
          )}" /></label>
          <label><span>Model</span><input name="anthropicModel" value="${escapeHtml(
            state.anthropicModel
          )}" placeholder="Enter a model name" /></label>
          <label><span>API key ${state.hasAnthropicKey ? "(saved)" : ""}</span><input type="password" name="anthropicKey" autocomplete="off" /></label>
        </div>
      </section>
      <section class="provider-section" data-provider="gemini">
        <h2>Gemini GenerateContent API</h2>
        <div class="grid">
          <label><span>Endpoint</span><input name="geminiEndpoint" value="${escapeHtml(
            state.geminiEndpoint
          )}" /></label>
          <label><span>Model</span><input name="geminiModel" value="${escapeHtml(
            state.geminiModel
          )}" placeholder="Enter a model name" /></label>
          <label><span>API key ${state.hasGeminiKey ? "(saved)" : ""}</span><input type="password" name="geminiKey" autocomplete="off" /></label>
        </div>
      </section>
      <section class="provider-section" data-provider="openai-compatible">
        <h2>OpenAI-compatible Chat Completions</h2>
        <div class="grid">
          <label><span>Endpoint</span><input name="llmEndpoint" value="${escapeHtml(
            state.llmEndpoint
          )}" /></label>
          <label><span>Model</span><input name="llmModel" value="${escapeHtml(
            state.llmModel
          )}" /></label>
          <label><span>API key ${state.hasOpenAiKey ? "(saved)" : ""}</span><input type="password" name="openAiKey" autocomplete="off" /></label>
        </div>
      </section>
      <section class="provider-section" data-provider="deepl">
        <h2>DeepL</h2>
        <div class="grid">
          <label><span>Endpoint</span><input name="deeplEndpoint" value="${escapeHtml(
            state.deeplEndpoint
          )}" /></label>
          <label><span>API key ${state.hasDeepLKey ? "(saved)" : ""}</span><input type="password" name="deeplKey" autocomplete="off" /></label>
        </div>
      </section>
      <section class="provider-section" data-provider="google">
        <h2>Google Cloud Translation</h2>
        <div class="grid">
          <label><span>Endpoint</span><input name="googleEndpoint" value="${escapeHtml(
            state.googleEndpoint
          )}" /></label>
          <label><span>API key ${state.hasGoogleKey ? "(saved)" : ""}</span><input type="password" name="googleKey" autocomplete="off" /></label>
        </div>
      </section>
      <section class="provider-section" data-provider="microsoft">
        <h2>Microsoft</h2>
        <div class="grid">
          <label><span>Endpoint</span><input name="microsoftEndpoint" value="${escapeHtml(
            state.microsoftEndpoint
          )}" /></label>
          <label><span>Region</span><input name="microsoftRegion" value="${escapeHtml(
            state.microsoftRegion
          )}" /></label>
          <label><span>API key ${state.hasMicrosoftKey ? "(saved)" : ""}</span><input type="password" name="microsoftKey" autocomplete="off" /></label>
        </div>
      </section>
      <section>
        <button type="submit">Save</button>
        <div class="status" data-state="${stateJson}"></div>
      </section>
    </form>
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    const form = document.getElementById("settings");
    const providerSelect = form.elements.namedItem("defaultProvider");
    const aiProviders = new Set(["openai-responses", "anthropic", "gemini", "openai-compatible"]);
    const syncProviderSections = () => {
      const selected = providerSelect.value;
      document.querySelectorAll(".provider-section").forEach((section) => {
        section.hidden = section.dataset.provider !== selected;
      });
      document.querySelector(".ai-limits").hidden = !aiProviders.has(selected);
    };
    providerSelect.addEventListener("change", syncProviderSections);
    syncProviderSections();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      vscode.postMessage({
        type: "save",
        values: {
          defaultProvider: data.get("defaultProvider"),
          outputDirectoryMode: data.get("outputDirectoryMode"),
          defaultTargetLanguage: data.get("defaultTargetLanguage"),
          cacheDirectoryName: data.get("cacheDirectoryName"),
          openAfterTranslate: data.get("openAfterTranslate") === "on",
          showDiffAfterTranslate: data.get("showDiffAfterTranslate") === "on",
          deleteStaleAutoTranslations: data.get("deleteStaleAutoTranslations") === "on",
          termLocks: String(data.get("termLocks") || "").split("\\n").map((item) => item.trim()).filter(Boolean),
          insertMarkdownHeader: data.get("insertMarkdownHeader") === "on",
          openAiEndpoint: data.get("openAiEndpoint"),
          openAiModel: data.get("openAiModel"),
          openAiResponsesKey: data.get("openAiResponsesKey"),
          llmEndpoint: data.get("llmEndpoint"),
          llmModel: data.get("llmModel"),
          llmMaxContextTokens: Number(data.get("llmMaxContextTokens")),
          llmMaxOutputTokens: Number(data.get("llmMaxOutputTokens")),
          openAiKey: data.get("openAiKey"),
          anthropicEndpoint: data.get("anthropicEndpoint"),
          anthropicModel: data.get("anthropicModel"),
          anthropicKey: data.get("anthropicKey"),
          geminiEndpoint: data.get("geminiEndpoint"),
          geminiModel: data.get("geminiModel"),
          geminiKey: data.get("geminiKey"),
          deeplEndpoint: data.get("deeplEndpoint"),
          deeplKey: data.get("deeplKey"),
          googleEndpoint: data.get("googleEndpoint"),
          googleKey: data.get("googleKey"),
          microsoftEndpoint: data.get("microsoftEndpoint"),
          microsoftRegion: data.get("microsoftRegion"),
          microsoftKey: data.get("microsoftKey")
        }
      });
    });
  </script>
</body>
</html>`;
}

function providerOptions(selected: string): string {
  return [
    ["openai-responses", "OpenAI Responses API"],
    ["anthropic", "Anthropic Messages API"],
    ["gemini", "Gemini GenerateContent API"],
    ["openai-compatible", "OpenAI-compatible Chat Completions"],
    ["deepl", "DeepL"],
    ["google", "Google Cloud Translation"],
    ["microsoft", "Microsoft Translator"]
  ]
    .map(([provider, label]) => {
      const isSelected = provider === selected ? "selected" : "";
      return `<option value="${provider}" ${isSelected}>${label}</option>`;
    })
    .join("");
}

function outputDirectoryModeOptions(selected: OutputDirectoryMode): string {
  return [
    ["same-dir", "same-dir"],
    ["hidden-cache", "hidden-cache"]
  ]
    .map(([value, label]) => {
      const isSelected = value === selected ? "selected" : "";
      return `<option value="${value}" ${isSelected}>${label}</option>`;
    })
    .join("");
}

function targetLanguageOptions(selected: string): string {
  return TARGET_LANGUAGES.map((language) => {
    const isSelected = language.code === selected ? "selected" : "";
    return `<option value="${escapeHtml(language.code)}" ${isSelected}>${escapeHtml(
      `${language.label} (${language.code})`
    )}</option>`;
  }).join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
