import * as vscode from "vscode";
import { translateDocument } from "../core/application/translateDocument";
import type { OutputDirectoryMode } from "../core/domain/types";
import { createProvider } from "../core/providers/providerFactory";
import { openSettingsPanel, SECRET_KEYS } from "./settingsPanel";
import { TranslationStatusBar } from "./translationStatusBar";

export function activate(context: vscode.ExtensionContext): void {
  const translationStatus = new TranslationStatusBar();
  context.subscriptions.push(
    translationStatus,
    vscode.commands.registerCommand("docTranslator.translateCurrentDocument", async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor || activeEditor.document.uri.scheme !== "file") {
        await vscode.window.showWarningMessage("Open a local file before translating.");
        return;
      }
      await runTranslate(context, activeEditor.document.uri, translationStatus);
    }),
    vscode.commands.registerCommand("docTranslator.translateFile", async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!targetUri || targetUri.scheme !== "file") {
        await vscode.window.showWarningMessage("Select a local file before translating.");
        return;
      }
      await runTranslate(context, targetUri, translationStatus);
    }),
    vscode.commands.registerCommand("docTranslator.openLastTranslation", async () => {
      await translationStatus.openLastTranslation();
    }),
    vscode.commands.registerCommand("docTranslator.setOpenAiCompatibleApiKey", async () => {
      const apiKey = await vscode.window.showInputBox({
        title: "OpenAI-Compatible API Key",
        password: true,
        ignoreFocusOut: true,
        prompt: "Stored in VS Code SecretStorage for this user."
      });
      if (!apiKey) {
        return;
      }
      await context.secrets.store(SECRET_KEYS.openAiCompatible, apiKey);
      await vscode.window.showInformationMessage("Doc Translator API key saved.");
    }),
    vscode.commands.registerCommand("docTranslator.openSettings", async () => {
      await openSettingsPanel(context);
    })
  );
}

export function deactivate(): void {
  // No background resources to dispose.
}

async function runTranslate(
  context: vscode.ExtensionContext,
  uri: vscode.Uri,
  translationStatus: TranslationStatusBar
): Promise<void> {
  if (translationStatus.isRunning()) {
    await vscode.window.showWarningMessage("Doc Translator is already translating a document.");
    return;
  }

  const config = vscode.workspace.getConfiguration("docTranslator");
  const targetLanguage = config.get<string>("defaultTargetLanguage", "zh-CN");
  const providerId = config.get<string>("defaultProvider", "fake");
  const cacheDirectoryName = config.get<string>(
    "cache.hiddenDirectoryName",
    ".vscode-doc-translator-cache"
  );
  const outputDirectoryMode = config.get<OutputDirectoryMode>("output.directoryMode", "same-dir");
  const insertMarkdownHeader = config.get<boolean>("markdown.insertAutoTranslationHeader", false);
  const openAfterTranslate = config.get<boolean>("output.openAfterTranslate", true);
  const showDiffAfterTranslate = config.get<boolean>("output.showDiffAfterTranslate", false);
  const termLocks = config.get<string[]>("termLocks", []);
  const openAiApiKey = await context.secrets.get(SECRET_KEYS.openAiCompatible);
  const deeplApiKey = await context.secrets.get(SECRET_KEYS.deepl);
  const googleApiKey = await context.secrets.get(SECRET_KEYS.google);
  const microsoftApiKey = await context.secrets.get(SECRET_KEYS.microsoft);

  translationStatus.start({
    sourcePath: uri.fsPath,
    providerId,
    targetLanguage
  });
  let provider: ReturnType<typeof createProvider>;
  try {
    provider = createProvider({
      providerId,
      openAiCompatible: {
        endpoint: config.get<string>("llm.endpoint", "https://api.openai.com/v1"),
        model: config.get<string>("llm.model", ""),
        apiKey: openAiApiKey,
        maxContextTokens: config.get<number>("llm.maxContextTokens", 128000),
        maxOutputTokens: config.get<number>("llm.maxOutputTokens", 4096),
        maxContextCharacters: optionalPositive(config.get<number>("llm.maxContextCharacters", 0))
      },
      deepl: {
        apiKey: deeplApiKey,
        endpoint: config.get<string>("deepl.endpoint", "https://api-free.deepl.com")
      },
      google: {
        apiKey: googleApiKey,
        endpoint: config.get<string>("google.endpoint", "https://translation.googleapis.com")
      },
      microsoft: {
        apiKey: microsoftApiKey,
        endpoint: config.get<string>(
          "microsoft.endpoint",
          "https://api.cognitive.microsofttranslator.com"
        ),
        region: config.get<string>("microsoft.region", "")
      }
    });
  } catch (error) {
    translationStatus.failed(error);
    await vscode.window.showErrorMessage(`Doc Translator failed: ${errorMessage(error)}`);
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Translating document",
      cancellable: false
    },
    async (progress) => {
      let lastProgress = 0;
      try {
        const result = await translateDocument({
          sourcePath: uri.fsPath,
          targetLanguage,
          provider,
          cacheDirectoryName,
          outputDirectoryMode,
          insertMarkdownHeader,
          termLocks,
          onProgress: (event) => {
            translationStatus.progress(event);
            const increment = Math.max(0, event.progress - lastProgress);
            lastProgress = Math.max(lastProgress, event.progress);
            progress.report({ increment, message: event.message });
          }
        });

        if (showDiffAfterTranslate) {
          await vscode.commands.executeCommand(
            "vscode.diff",
            uri,
            vscode.Uri.file(result.targetPath),
            "Doc Translator Diff"
          );
        } else if (openAfterTranslate) {
          const document = await vscode.workspace.openTextDocument(result.targetPath);
          await vscode.window.showTextDocument(document, { preview: false });
        }

        const suffix =
          result.status === "cached" ? "Opened cached translation." : "Translation complete.";
        if (result.status === "cached") {
          translationStatus.cached(result);
        } else {
          translationStatus.succeeded(result);
        }
        await vscode.window.showInformationMessage(`${suffix} ${result.targetPath}`);
      } catch (error) {
        translationStatus.failed(error);
        await vscode.window.showErrorMessage(`Doc Translator failed: ${errorMessage(error)}`);
      }
    }
  );
}

function optionalPositive(value: number | undefined): number | undefined {
  return value && value > 0 ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
