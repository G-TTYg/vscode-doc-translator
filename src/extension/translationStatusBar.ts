import path from "node:path";
import * as vscode from "vscode";
import type { TranslateDocumentResult, TranslationProgress } from "../core/domain/types";

const OPEN_LAST_TRANSLATION_COMMAND = "docTranslator.openLastTranslation";

export class TranslationStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private lastTranslationUri: vscode.Uri | undefined;
  private running = false;
  private currentLabel = "";
  private currentProvider = "";

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.item.name = "Doc Translator";
    this.setIdle();
    this.item.show();
  }

  isRunning(): boolean {
    return this.running;
  }

  start(input: { readonly sourcePath: string; readonly providerId: string; readonly targetLanguage: string }): void {
    this.running = true;
    this.currentLabel = path.basename(input.sourcePath);
    this.currentProvider = input.providerId;
    this.lastTranslationUri = undefined;
    this.item.command = undefined;
    this.item.backgroundColor = undefined;
    this.item.text = "$(sync~spin) Doc Translator 0%";
    this.item.tooltip = this.tooltip(
      "Running",
      `Translating ${this.currentLabel} to ${input.targetLanguage} with ${input.providerId}.`
    );
    this.item.show();
  }

  progress(progress: TranslationProgress): void {
    if (!this.running) {
      return;
    }
    const percent = Math.max(0, Math.min(100, Math.round(progress.progress)));
    this.item.text = `$(sync~spin) Doc Translator ${percent}%`;
    this.item.tooltip = this.tooltip(
      "Running",
      `${progress.message}\n\nFile: ${this.currentLabel}\nProvider: ${this.currentProvider}`
    );
  }

  cached(result: TranslateDocumentResult): void {
    this.finish("$(database) Doc Translator: Cached", "Cached", result);
  }

  succeeded(result: TranslateDocumentResult): void {
    this.finish("$(check) Doc Translator: Done", "Success", result);
  }

  failed(error: unknown): void {
    this.running = false;
    this.item.command = "docTranslator.openSettings";
    this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    this.item.text = "$(error) Doc Translator: Failed";
    this.item.tooltip = this.tooltip("Failed", error instanceof Error ? error.message : String(error));
    this.item.show();
  }

  async openLastTranslation(): Promise<void> {
    if (!this.lastTranslationUri) {
      await vscode.commands.executeCommand("docTranslator.openSettings");
      return;
    }
    const document = await vscode.workspace.openTextDocument(this.lastTranslationUri);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  dispose(): void {
    this.item.dispose();
  }

  private finish(text: string, title: string, result: TranslateDocumentResult): void {
    this.running = false;
    this.lastTranslationUri = vscode.Uri.file(result.targetPath);
    this.item.backgroundColor = undefined;
    this.item.command = OPEN_LAST_TRANSLATION_COMMAND;
    this.item.text = text;
    this.item.tooltip = this.tooltip(
      title,
      `Target: ${result.targetPath}\nMetadata: ${result.metadataPath}\nClick to open the translated document.`
    );
    this.item.show();
  }

  private setIdle(): void {
    this.running = false;
    this.item.text = "$(globe) Doc Translator: Idle";
    this.item.tooltip = this.tooltip("Idle", "No translation task is running. Click to open settings.");
    this.item.command = "docTranslator.openSettings";
    this.item.backgroundColor = undefined;
  }

  private tooltip(title: string, body: string): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.isTrusted = true;
    markdown.appendMarkdown(`**Doc Translator: ${title}**\n\n`);
    markdown.appendText(body);
    return markdown;
  }
}
