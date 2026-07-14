import { promises as fs } from "node:fs";
import path from "node:path";
import { sha256Hex } from "../domain/hash";
import {
  DEFAULT_CACHE_DIRECTORY_NAME,
  createOutputNames,
  formatTimestampUtc,
  relativeToDirectory
} from "../domain/naming";
import { applyTermLocks, restoreTermLocks } from "../domain/termLocks";
import type {
  OutputDirectoryMode,
  TranslateDocumentOptions,
  TranslateDocumentResult,
  TranslationProgress,
  TranslatedUnit,
  TranslationMap,
  TranslationMetadata
} from "../domain/types";
import { selectFormatAdapter } from "../formats";
import { validateTranslatedUnits } from "../providers/validation";
import { findFreshTranslation, writeFileAtomic, writeMetadata } from "./metadataStore";

const CORE_VERSION = "0.1.0";

export async function translateDocument(
  options: TranslateDocumentOptions
): Promise<TranslateDocumentResult> {
  const sourcePath = path.resolve(options.sourcePath);
  const sourceDirectory = path.dirname(sourcePath);
  const cacheDirectoryName = options.cacheDirectoryName ?? DEFAULT_CACHE_DIRECTORY_NAME;
  const outputDirectoryMode = options.outputDirectoryMode ?? "same-dir";
  const sourceLanguage = options.sourceLanguage ?? "auto";
  const now = options.now ?? new Date();

  const sourceBytes = await fs.readFile(sourcePath);
  const sourceHash = sha256Hex(sourceBytes);
  reportProgress(options, {
    stage: "checking-cache",
    message: "Checking translation cache",
    progress: 5
  });

  if (!options.force) {
    const fresh = await findFreshTranslation({
      sourceDirectory,
      sourceHash,
      targetLanguage: options.targetLanguage,
      providerId: options.provider.id,
      outputDirectoryMode,
      cacheDirectoryName
    });
    if (fresh) {
      reportProgress(options, {
        stage: "cached",
        message: "Using cached translation",
        progress: 100
      });
      return {
        status: "cached",
        sourcePath,
        targetPath: fresh.targetPath,
        metadataPath: fresh.metadataPath,
        metadata: fresh.metadata,
        warnings: []
      };
    }
  }

  reportProgress(options, {
    stage: "parsing",
    message: "Parsing source document",
    progress: 15
  });
  const sourceText = stripUtf8Bom(sourceBytes.toString("utf8"));
  const adapter = selectFormatAdapter(sourcePath);
  const parsed = await adapter.parse({ sourcePath, text: sourceText });
  const extractedUnits = await adapter.extractUnits(parsed);
  const termLocked = applyTermLocks(extractedUnits, options.termLocks ?? []);
  const units = termLocked.units;
  const documentId = `${relativeToDirectory(sourceDirectory, sourcePath)}:sha256:${sourceHash}`;
  reportProgress(options, {
    stage: "preparing",
    message: `Preparing ${units.length} translation segment${units.length === 1 ? "" : "s"}`,
    progress: 30
  });
  const providerRequest =
    options.provider.capabilities.requestPackaging === "ordered-json-context"
      ? {
          sourceLanguage,
          targetLanguage: options.targetLanguage,
          units,
          orderedContext: await buildOrderedContext(adapter, parsed, units, {
            documentId,
            sourceLanguage,
            targetLanguage: options.targetLanguage
          })
        }
      : {
          sourceLanguage,
          targetLanguage: options.targetLanguage,
          units
        };

  reportProgress(options, {
    stage: "translating",
    message: `Translating with ${options.provider.displayName}`,
    progress: 45
  });
  const providerResult = await options.provider.translateBatch(providerRequest);
  const translatedUnits = resultToMap(providerResult.translations, termLocked.tokensByUnitId);
  const providerWarnings = validateTranslatedUnits(units, providerResult);

  reportProgress(options, {
    stage: "validating",
    message: "Validating translated segments",
    progress: 75
  });
  const validationIssues = adapter.validate ? await adapter.validate(parsed, translatedUnits) : [];
  const validationErrors = validationIssues.filter((issue) => issue.severity === "error");
  if (validationErrors.length > 0) {
    throw new Error(
      `Translation validation failed: ${validationErrors.map((issue) => issue.message).join("; ")}`
    );
  }

  const reconstructed = await adapter.reconstruct(parsed, translatedUnits);
  const markdownHeaderInserted =
    adapter.id === "markdown" && Boolean(options.insertMarkdownHeader);
  const translatedText = markdownHeaderInserted
    ? `<!-- Auto-translated by VSCode Doc Translator. Metadata is stored in ${cacheDirectoryName}. -->\n\n${reconstructed.text}`
    : reconstructed.text;
  const translatedBytes = Buffer.from(translatedText, "utf8");
  const translatedHash = sha256Hex(translatedBytes);
  const timestamp = formatTimestampUtc(now);
  const names = createOutputNames({
    sourcePath,
    targetLanguage: options.targetLanguage,
    timestamp,
    sourceHash,
    translatedHash
  });
  const targetPath = path.join(
    outputDirectoryPath(sourceDirectory, cacheDirectoryName, outputDirectoryMode),
    names.translatedFileName
  );
  reportProgress(options, {
    stage: "writing",
    message: "Writing translated document",
    progress: 90
  });
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await assertOutputDoesNotExist(targetPath);
  await writeFileAtomic(targetPath, translatedBytes);

  const targetStat = await fs.stat(targetPath);
  const sourceStat = await fs.stat(sourcePath);
  const warnings = [
    ...providerWarnings,
    ...validationIssues.filter((issue) => issue.severity === "warning").map((issue) => issue.message),
    ...reconstructed.warnings
  ];
  const metadata: TranslationMetadata = {
    schemaVersion: 1,
    translationId: `${relativeToDirectory(sourceDirectory, sourcePath)}:sha256:${sourceHash}:${
      options.targetLanguage
    }:${timestamp}`,
    status: "complete",
    createdAt: now.toISOString(),
    source: {
      relativePath: relativeToDirectory(sourceDirectory, sourcePath),
      sha256: sourceHash,
      sizeBytes: sourceBytes.byteLength,
      mtimeUtc: sourceStat.mtime.toISOString(),
      language: sourceLanguage
    },
    target: {
      language: options.targetLanguage,
      relativePath: relativeToDirectory(sourceDirectory, targetPath),
      directoryMode: outputDirectoryMode,
      sha256: translatedHash,
      sizeBytes: targetStat.size
    },
    format: {
      adapter: adapter.id,
      adapterVersion: adapter.version,
      lineEnding: parsed.lineEnding,
      encoding: "utf8"
    },
    provider: {
      id: options.provider.id,
      requestPackaging: options.provider.capabilities.requestPackaging,
      maxContextCharacters: options.provider.capabilities.maxContextCharacters,
      maxContextTokens: options.provider.capabilities.maxContextTokens,
      maxOutputTokens: options.provider.capabilities.maxOutputTokens
    },
    profile: {
      name: options.profileName ?? "default",
      hash: sha256Hex(
        JSON.stringify({
          provider: options.provider.id,
          targetLanguage: options.targetLanguage,
          outputDirectoryMode,
          insertMarkdownHeader: markdownHeaderInserted,
          termLocks: options.termLocks ?? []
        })
      )
    },
    pipeline: {
      coreVersion: CORE_VERSION,
      segmenterVersion: adapter.version,
      segmentCount: units.length,
      translatedSegmentCount: translatedUnits.size,
      requestCount: providerResult.requestCount,
      markdownHeaderInserted,
      warnings
    }
  };

  const metadataPath = await writeMetadata({
    sourceDirectory,
    metadataFileName: names.metadataFileName,
    metadata,
    cacheDirectoryName
  });

  reportProgress(options, {
    stage: "complete",
    message: "Translation complete",
    progress: 100
  });

  return {
    status: "translated",
    sourcePath,
    targetPath,
    metadataPath,
    metadata,
    warnings
  };
}

function resultToMap(
  translations: readonly TranslatedUnit[],
  termTokensByUnitId: ReadonlyMap<string, readonly { readonly token: string; readonly value: string }[]>
): TranslationMap {
  return new Map(
    translations.map((translation) => [
      translation.id,
      restoreTermLocks(translation.text, termTokensByUnitId.get(translation.id))
    ])
  );
}

async function buildOrderedContext(
  adapter: ReturnType<typeof selectFormatAdapter>,
  parsed: Parameters<typeof adapter.extractUnits>[0],
  units: Awaited<ReturnType<typeof adapter.extractUnits>>,
  request: {
    readonly documentId: string;
    readonly sourceLanguage: string | "auto";
    readonly targetLanguage: string;
  }
) {
  if (!adapter.buildOrderedJsonContext) {
    throw new Error(`Adapter ${adapter.id} does not support ordered JSON context.`);
  }
  return adapter.buildOrderedJsonContext(parsed, units, request);
}

async function assertOutputDoesNotExist(targetPath: string): Promise<void> {
  try {
    await fs.stat(targetPath);
  } catch {
    return;
  }
  throw new Error(`Output file already exists: ${targetPath}`);
}

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function reportProgress(
  options: TranslateDocumentOptions,
  progress: TranslationProgress
): void {
  options.onProgress?.(progress);
}

function outputDirectoryPath(
  sourceDirectory: string,
  cacheDirectoryName: string,
  outputDirectoryMode: OutputDirectoryMode
): string {
  return outputDirectoryMode === "hidden-cache"
    ? path.join(sourceDirectory, cacheDirectoryName)
    : sourceDirectory;
}
