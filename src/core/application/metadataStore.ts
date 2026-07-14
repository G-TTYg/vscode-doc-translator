import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_CACHE_DIRECTORY_NAME } from "../domain/naming";
import { sha256Hex } from "../domain/hash";
import type { OutputDirectoryMode, TranslationMetadata } from "../domain/types";

const execFileAsync = promisify(execFile);

export interface FreshTranslationQuery {
  readonly sourceDirectory: string;
  readonly sourceHash: string;
  readonly targetLanguage: string;
  readonly providerId: string;
  readonly outputDirectoryMode?: OutputDirectoryMode;
  readonly cacheDirectoryName?: string;
}

export interface FreshTranslation {
  readonly metadata: TranslationMetadata;
  readonly metadataPath: string;
  readonly targetPath: string;
}

export async function findFreshTranslation(
  query: FreshTranslationQuery
): Promise<FreshTranslation | undefined> {
  const cacheDirectory = cacheDirectoryPath(query.sourceDirectory, query.cacheDirectoryName);
  const entries = await safeReadDirectory(cacheDirectory);
  const candidates: FreshTranslation[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".meta.json")) {
      continue;
    }

    const metadataPath = path.join(cacheDirectory, entry);
    const metadata = await readMetadata(metadataPath);
    if (!metadata) {
      continue;
    }

    if (
      metadata.status !== "complete" ||
      metadata.source.sha256 !== query.sourceHash ||
      metadata.target.language !== query.targetLanguage ||
      metadata.provider.id !== query.providerId ||
      inferOutputDirectoryMode(metadata, query.cacheDirectoryName) !==
        (query.outputDirectoryMode ?? "same-dir")
    ) {
      continue;
    }

    const targetPath = path.join(query.sourceDirectory, metadata.target.relativePath);
    const targetBytes = await safeReadFile(targetPath);
    if (!targetBytes || sha256Hex(targetBytes) !== metadata.target.sha256) {
      continue;
    }

    candidates.push({ metadata, metadataPath, targetPath });
  }

  return candidates.sort((a, b) => b.metadata.createdAt.localeCompare(a.metadata.createdAt))[0];
}

export async function writeMetadata(input: {
  readonly sourceDirectory: string;
  readonly metadataFileName: string;
  readonly metadata: TranslationMetadata;
  readonly cacheDirectoryName?: string;
}): Promise<string> {
  const cacheDirectory = cacheDirectoryPath(input.sourceDirectory, input.cacheDirectoryName);
  await fs.mkdir(cacheDirectory, { recursive: true });
  await tryHideDirectoryOnWindows(cacheDirectory);

  const metadataPath = path.join(cacheDirectory, input.metadataFileName);
  await writeFileAtomic(metadataPath, `${JSON.stringify(input.metadata, null, 2)}\n`);
  return metadataPath;
}

export async function writeFileAtomic(filePath: string, contents: Buffer | string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, contents);
  await fs.rename(tempPath, filePath);
}

export function cacheDirectoryPath(sourceDirectory: string, cacheDirectoryName?: string): string {
  return path.join(sourceDirectory, cacheDirectoryName ?? DEFAULT_CACHE_DIRECTORY_NAME);
}

function inferOutputDirectoryMode(
  metadata: TranslationMetadata,
  cacheDirectoryName?: string
): OutputDirectoryMode {
  if (metadata.target.directoryMode) {
    return metadata.target.directoryMode;
  }
  const cacheName = cacheDirectoryName ?? DEFAULT_CACHE_DIRECTORY_NAME;
  return metadata.target.relativePath === cacheName ||
    metadata.target.relativePath.startsWith(`${cacheName}/`)
    ? "hidden-cache"
    : "same-dir";
}

async function readMetadata(metadataPath: string): Promise<TranslationMetadata | undefined> {
  try {
    return JSON.parse(await fs.readFile(metadataPath, "utf8")) as TranslationMetadata;
  } catch {
    return undefined;
  }
}

async function safeReadDirectory(directory: string): Promise<readonly string[]> {
  try {
    return await fs.readdir(directory);
  } catch {
    return [];
  }
}

async function safeReadFile(filePath: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return undefined;
  }
}

async function tryHideDirectoryOnWindows(directory: string): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }
  try {
    await execFileAsync("attrib", ["+h", directory]);
  } catch {
    // Hidden attribute is a UX nicety; the dot-prefixed directory remains the durable contract.
  }
}
