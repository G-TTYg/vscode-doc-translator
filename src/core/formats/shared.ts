import path from "node:path";
import { sha256Hex } from "../domain/hash";
import type {
  OrderedDocumentContext,
  ParsedDocument,
  TranslationUnit,
  TranslationUnitKind
} from "../domain/types";

export interface SpanTranslationUnit extends TranslationUnit {
  readonly span: {
    readonly start: number;
    readonly end: number;
  };
}

export interface SpanParsedDocument extends ParsedDocument {
  readonly units: readonly SpanTranslationUnit[];
}

export function detectLineEnding(text: string): ParsedDocument["lineEnding"] {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  if (crlf > 0 && lf > 0) {
    return "mixed";
  }
  return crlf > 0 ? "crlf" : "lf";
}

export function createUnitId(input: {
  readonly adapterId: string;
  readonly sourcePath: string;
  readonly order: number;
  readonly kind: TranslationUnitKind;
  readonly sourceText: string;
}): string {
  const baseName = path.basename(input.sourcePath);
  const textHash = sha256Hex(input.sourceText).slice(0, 10);
  return `${input.adapterId}:${baseName}:${input.kind}:${input.order}:${textHash}`;
}

export function buildOrderedContext(input: {
  readonly document: SpanParsedDocument;
  readonly adapterId: string;
  readonly documentId: string;
  readonly sourceLanguage: string | "auto";
  readonly targetLanguage: string;
  readonly units: readonly TranslationUnit[];
}): OrderedDocumentContext {
  return {
    documentId: input.documentId,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    format: input.adapterId,
    units: input.units.map((unit) => ({
      ...unit,
      nearbyContext: nearbyContextFor(input.document.text, unit.sourceText)
    }))
  };
}

export function applySpanTranslations(
  text: string,
  units: readonly SpanTranslationUnit[],
  translations: Map<string, string>
): string {
  let result = "";
  let cursor = 0;

  for (const unit of [...units].sort((a, b) => a.span.start - b.span.start)) {
    result += text.slice(cursor, unit.span.start);
    result += translations.get(unit.id) ?? text.slice(unit.span.start, unit.span.end);
    cursor = unit.span.end;
  }

  result += text.slice(cursor);
  return result;
}

function nearbyContextFor(documentText: string, unitText: string): string {
  const index = documentText.indexOf(unitText);
  if (index < 0) {
    return "";
  }
  const start = Math.max(0, index - 160);
  const end = Math.min(documentText.length, index + unitText.length + 160);
  return documentText.slice(start, end);
}
