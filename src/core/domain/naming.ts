import path from "node:path";
import { hashPrefix } from "./hash";

export const DEFAULT_CACHE_DIRECTORY_NAME = ".vscode-doc-translator-cache";

export interface OutputNames {
  readonly timestamp: string;
  readonly translatedFileName: string;
  readonly metadataFileName: string;
}

export function formatTimestampUtc(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = date.getUTCDate().toString().padStart(2, "0");
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const min = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
}

export function createOutputNames(input: {
  readonly sourcePath: string;
  readonly targetLanguage: string;
  readonly timestamp: string;
  readonly sourceHash: string;
  readonly translatedHash?: string;
}): OutputNames {
  const parsed = path.parse(input.sourcePath);
  const sourceBase = parsed.name || "document";
  const translatedFileName = `${sourceBase}.auto.${input.targetLanguage}.${input.timestamp}${parsed.ext}`;
  const translatedHashPrefix = input.translatedHash ? hashPrefix(input.translatedHash) : "pending";
  const metadataFileName = `${sourceBase}.auto.${input.targetLanguage}.${input.timestamp}.src-${hashPrefix(
    input.sourceHash
  )}.dst-${translatedHashPrefix}.meta.json`;

  return {
    timestamp: input.timestamp,
    translatedFileName,
    metadataFileName
  };
}

export function relativeToDirectory(directory: string, filePath: string): string {
  return path.relative(directory, filePath).split(path.sep).join("/");
}
