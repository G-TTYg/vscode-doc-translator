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

export interface HtmlXmlDocument extends SpanParsedDocument {
  readonly format: "html-xml";
}

export class HtmlXmlAdapter implements DocumentFormatAdapter<HtmlXmlDocument> {
  readonly id = "html-xml";
  readonly version = "0.1.0";

  canHandle(file: SourceFileInfo): boolean {
    return [".html", ".htm", ".xml"].includes(file.extension);
  }

  async parse(input: ParseInput): Promise<HtmlXmlDocument> {
    return {
      format: "html-xml",
      sourcePath: input.sourcePath,
      text: input.text,
      lineEnding: detectLineEnding(input.text),
      units: extractTextNodeUnits(input.sourcePath, input.text, this.id)
    };
  }

  async extractUnits(document: HtmlXmlDocument): Promise<readonly TranslationUnit[]> {
    return document.units;
  }

  async buildOrderedJsonContext(
    document: HtmlXmlDocument,
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
    document: HtmlXmlDocument,
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

function extractTextNodeUnits(
  sourcePath: string,
  text: string,
  adapterId: string
): readonly SpanTranslationUnit[] {
  const units: SpanTranslationUnit[] = [];
  const tagPattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>/g;
  let cursor = 0;
  let order = 0;
  let skipTextUntilClosingTag: string | undefined;

  for (const match of text.matchAll(tagPattern)) {
    if (match.index === undefined) {
      continue;
    }

    if (!skipTextUntilClosingTag) {
      order = pushTextNodeUnits(units, {
        adapterId,
        sourcePath,
        order,
        text,
        start: cursor,
        end: match.index
      });
    }

    const tag = match[0];
    const lowerTag = tag.toLowerCase();
    if (/^<\s*(script|style)\b/.test(lowerTag)) {
      skipTextUntilClosingTag = lowerTag.includes("<script") ? "script" : "style";
    } else if (
      skipTextUntilClosingTag &&
      new RegExp(`^<\\s*/\\s*${skipTextUntilClosingTag}\\s*>`).test(lowerTag)
    ) {
      skipTextUntilClosingTag = undefined;
    }

    cursor = match.index + tag.length;
  }

  if (!skipTextUntilClosingTag) {
    pushTextNodeUnits(units, {
      adapterId,
      sourcePath,
      order,
      text,
      start: cursor,
      end: text.length
    });
  }

  return units;
}

function pushTextNodeUnits(
  units: SpanTranslationUnit[],
  input: {
    readonly adapterId: string;
    readonly sourcePath: string;
    readonly order: number;
    readonly text: string;
    readonly start: number;
    readonly end: number;
  }
): number {
  const sourceText = input.text.slice(input.start, input.end);
  if (sourceText.trim().length === 0) {
    return input.order;
  }

  const leading = sourceText.length - sourceText.trimStart().length;
  const trailing = sourceText.length - sourceText.trimEnd().length;
  const start = input.start + leading;
  const end = input.end - trailing;
  const trimmedText = input.text.slice(start, end);

  units.push({
    id: createUnitId({
      adapterId: input.adapterId,
      sourcePath: input.sourcePath,
      order: input.order,
      kind: "text",
      sourceText: trimmedText
    }),
    order: input.order,
    kind: "text",
    sourceText: trimmedText,
    protectedTokens: [],
    span: { start, end }
  });

  return input.order + 1;
}
