import path from "node:path";
import { restoreProtectedTokens } from "../domain/protection";
import type {
  DocumentFormatAdapter,
  OrderedDocumentContext,
  ParseInput,
  ReconstructedDocument,
  SourceFileInfo,
  TranslationMap,
  TranslationUnit
} from "../domain/types";
import {
  applySpanTranslations,
  buildOrderedContext,
  createUnitId,
  detectLineEnding,
  type SpanParsedDocument,
  type SpanTranslationUnit
} from "./shared";

export interface PlainTextDocument extends SpanParsedDocument {
  readonly format: "plain-text";
}

export class PlainTextAdapter implements DocumentFormatAdapter<PlainTextDocument> {
  readonly id = "plain-text";
  readonly version = "0.1.0";

  canHandle(file: SourceFileInfo): boolean {
    return file.extension === ".txt" || file.extension === "";
  }

  async parse(input: ParseInput): Promise<PlainTextDocument> {
    return {
      format: "plain-text",
      sourcePath: input.sourcePath,
      text: input.text,
      lineEnding: detectLineEnding(input.text),
      units: extractParagraphUnits(input.sourcePath, input.text, this.id)
    };
  }

  async extractUnits(document: PlainTextDocument): Promise<readonly TranslationUnit[]> {
    return document.units;
  }

  async buildOrderedJsonContext(
    document: PlainTextDocument,
    units: readonly TranslationUnit[],
    request: {
      readonly documentId: string;
      readonly sourceLanguage: string | "auto";
      readonly targetLanguage: string;
    }
  ): Promise<OrderedDocumentContext> {
    return buildOrderedContext({
      document,
      adapterId: this.id,
      documentId: request.documentId,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      units
    });
  }

  async reconstruct(
    document: PlainTextDocument,
    translations: TranslationMap
  ): Promise<ReconstructedDocument> {
    const restoredTranslations = new Map<string, string>();
    for (const unit of document.units) {
      const translated = translations.get(unit.id);
      if (translated !== undefined) {
        restoredTranslations.set(unit.id, restoreProtectedTokens(translated, unit.protectedTokens));
      }
    }

    return {
      text: applySpanTranslations(document.text, document.units, restoredTranslations),
      warnings: []
    };
  }
}

function extractParagraphUnits(
  sourcePath: string,
  text: string,
  adapterId: string
): readonly SpanTranslationUnit[] {
  const units: SpanTranslationUnit[] = [];
  const pattern = /[^\r\n](?:.*[^\r\n])?/g;
  let order = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined || match[0].trim().length === 0) {
      continue;
    }
    const sourceText = match[0];
    units.push({
      id: createUnitId({
        adapterId,
        sourcePath: path.basename(sourcePath),
        order,
        kind: "paragraph",
        sourceText
      }),
      order,
      kind: "paragraph",
      sourceText,
      protectedTokens: [],
      span: {
        start: match.index,
        end: match.index + sourceText.length
      }
    });
    order += 1;
  }

  return units;
}
