#!/usr/bin/env node
import { translateDocument } from "../core/application/translateDocument";
import type { OutputDirectoryMode } from "../core/domain/types";
import { createProvider } from "../core/providers/providerFactory";

interface CliOptions {
  readonly command?: string;
  readonly sourcePath?: string;
  readonly targetLanguage: string;
  readonly sourceLanguage: string | "auto";
  readonly providerId: string;
  readonly force: boolean;
  readonly json: boolean;
  readonly insertMarkdownHeader: boolean;
  readonly cacheDirectoryName?: string;
  readonly outputDirectoryMode: OutputDirectoryMode;
  readonly termLocks: readonly string[];
  readonly endpoint?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly llmMaxContextCharacters?: number;
  readonly llmMaxContextTokens?: number;
  readonly llmMaxOutputTokens?: number;
  readonly deeplApiKey?: string;
  readonly deeplEndpoint?: string;
  readonly googleApiKey?: string;
  readonly googleEndpoint?: string;
  readonly microsoftApiKey?: string;
  readonly microsoftRegion?: string;
  readonly microsoftEndpoint?: string;
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  if (options.command !== "translate" || !options.sourcePath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const provider = createProvider({
    providerId: options.providerId,
    openAiCompatible: {
      endpoint: options.endpoint,
      model: options.model,
      apiKey: options.apiKey,
      maxContextCharacters: options.llmMaxContextCharacters,
      maxContextTokens: options.llmMaxContextTokens,
      maxOutputTokens: options.llmMaxOutputTokens
    },
    deepl: {
      apiKey: options.deeplApiKey,
      endpoint: options.deeplEndpoint
    },
    google: {
      apiKey: options.googleApiKey,
      endpoint: options.googleEndpoint
    },
    microsoft: {
      apiKey: options.microsoftApiKey,
      region: options.microsoftRegion,
      endpoint: options.microsoftEndpoint
    }
  });

  const result = await translateDocument({
    sourcePath: options.sourcePath,
    targetLanguage: options.targetLanguage,
    sourceLanguage: options.sourceLanguage,
    provider,
    force: options.force,
    insertMarkdownHeader: options.insertMarkdownHeader,
    cacheDirectoryName: options.cacheDirectoryName,
    outputDirectoryMode: options.outputDirectoryMode,
    termLocks: options.termLocks
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      `status: ${result.status}`,
      `target: ${result.targetPath}`,
      `metadata: ${result.metadataPath}`,
      ...result.warnings.map((warning) => `warning: ${warning}`)
    ].join("\n") + "\n"
  );
}

function parseArgs(argv: readonly string[]): CliOptions {
  const [command, sourcePath, ...rest] = argv;
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    if (key === "force" || key === "json" || key === "insert-markdown-header") {
      options[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }

  return {
    command,
    sourcePath,
    targetLanguage: stringOption(options, "to", "zh-CN"),
    sourceLanguage: stringOption(options, "from", "auto") as string | "auto",
    providerId: stringOption(options, "provider", "fake"),
    force: Boolean(options.force),
    json: Boolean(options.json),
    insertMarkdownHeader: Boolean(options["insert-markdown-header"]),
    cacheDirectoryName: optionalString(options, "cache-dir"),
    outputDirectoryMode: outputDirectoryModeOption(options, "output", "same-dir"),
    termLocks: splitCsvOption(options, "term-locks"),
    endpoint: optionalString(options, "endpoint"),
    model: optionalString(options, "model"),
    apiKey: optionalString(options, "api-key"),
    llmMaxContextCharacters: optionalNumber(options, "llm-max-context-chars"),
    llmMaxContextTokens: optionalNumber(options, "llm-max-context-tokens"),
    llmMaxOutputTokens: optionalNumber(options, "llm-max-output-tokens"),
    deeplApiKey: optionalString(options, "deepl-api-key"),
    deeplEndpoint: optionalString(options, "deepl-endpoint"),
    googleApiKey: optionalString(options, "google-api-key"),
    googleEndpoint: optionalString(options, "google-endpoint"),
    microsoftApiKey: optionalString(options, "microsoft-api-key"),
    microsoftRegion: optionalString(options, "microsoft-region"),
    microsoftEndpoint: optionalString(options, "microsoft-endpoint")
  };
}

function stringOption(options: Record<string, string | boolean>, key: string, fallback: string): string {
  const value = options[key];
  return typeof value === "string" ? value : fallback;
}

function optionalString(options: Record<string, string | boolean>, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(options: Record<string, string | boolean>, key: string): number | undefined {
  const value = options[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function outputDirectoryModeOption(
  options: Record<string, string | boolean>,
  key: string,
  fallback: OutputDirectoryMode
): OutputDirectoryMode {
  const value = optionalString(options, key);
  if (!value) {
    return fallback;
  }
  if (value === "same-dir" || value === "hidden-cache") {
    return value;
  }
  throw new Error(`Invalid --${key}. Expected same-dir or hidden-cache.`);
}

function splitCsvOption(options: Record<string, string | boolean>, key: string): readonly string[] {
  const value = options[key];
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function printUsage(): void {
  process.stderr.write(`Usage:
  vscode-doc-translator translate <file> --to zh-CN [--from auto] [--provider fake|openai-compatible|deepl|google|microsoft]

Options:
  --force                    Create a new translation even when a fresh cached artifact exists.
  --json                     Print JSON result.
  --insert-markdown-header   Add an auto-translation HTML comment header to Markdown outputs.
  --cache-dir <name>         Override the hidden cache directory name.
  --output <mode>            Output location: same-dir or hidden-cache.
  --term-locks <csv>         Comma-separated terms that must remain untranslated.
  --endpoint <url>           OpenAI-compatible endpoint.
  --model <name>             OpenAI-compatible model.
  --api-key <key>            OpenAI-compatible API key. Prefer env DOC_TRANSLATOR_OPENAI_API_KEY.
  --llm-max-context-chars <n> Deprecated compatibility limit, approximated into token budget.
  --llm-max-context-tokens <n> Model maximum context window in tokens.
  --llm-max-output-tokens <n> Maximum tokens requested for each LLM response.
  --deepl-api-key <key>      DeepL API key. Prefer env DOC_TRANSLATOR_DEEPL_API_KEY.
  --google-api-key <key>     Google Cloud Translation API key. Prefer env DOC_TRANSLATOR_GOOGLE_API_KEY.
  --microsoft-api-key <key>  Microsoft Translator API key. Prefer env DOC_TRANSLATOR_MICROSOFT_API_KEY.
  --microsoft-region <name>  Microsoft Translator region. Prefer env DOC_TRANSLATOR_MICROSOFT_REGION.
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
