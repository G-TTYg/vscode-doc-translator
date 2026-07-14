import {
  findMissingProtectedTokens,
  restoreProtectedTokens
} from "../domain/protection";
import type {
  DocumentFormatAdapter,
  OrderedDocumentContext,
  ParseInput,
  ReconstructedDocument,
  SourceFileInfo,
  TranslationMap,
  TranslationUnit,
  ValidationIssue
} from "../domain/types";
import { extractMarkdownUnits } from "./markdownAdapter";
import {
  applySpanTranslations,
  buildOrderedContext,
  detectLineEnding,
  type SpanParsedDocument
} from "./shared";

export interface MdxDocument extends SpanParsedDocument {
  readonly format: "mdx";
}

export class MdxAdapter implements DocumentFormatAdapter<MdxDocument> {
  readonly id = "mdx";
  readonly version = "0.1.0";

  canHandle(file: SourceFileInfo): boolean {
    return file.extension === ".mdx";
  }

  async parse(input: ParseInput): Promise<MdxDocument> {
    return {
      format: "mdx",
      sourcePath: input.sourcePath,
      text: input.text,
      lineEnding: detectLineEnding(input.text),
      units: extractMarkdownUnits(input.sourcePath, input.text, this.id, {
        skipMdxStructuralLines: true
      })
    };
  }

  async extractUnits(document: MdxDocument): Promise<readonly TranslationUnit[]> {
    return document.units;
  }

  async buildOrderedJsonContext(
    document: MdxDocument,
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

  async validate(document: MdxDocument, translations: TranslationMap): Promise<readonly ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    for (const unit of document.units) {
      const translated = translations.get(unit.id);
      if (translated === undefined) {
        issues.push({
          unitId: unit.id,
          severity: "error",
          message: "Missing translation for extracted unit."
        });
        continue;
      }

      const missing = findMissingProtectedTokens(translated, unit.protectedTokens);
      for (const token of missing) {
        issues.push({
          unitId: unit.id,
          severity: "error",
          message: `Protected token was changed or removed: ${token.token}`
        });
      }
    }
    return issues;
  }

  async reconstruct(document: MdxDocument, translations: TranslationMap): Promise<ReconstructedDocument> {
    const restoredTranslations = new Map<string, string>();
    const warnings: string[] = [];

    for (const unit of document.units) {
      const translated = translations.get(unit.id);
      if (translated === undefined) {
        warnings.push(`Missing translation for ${unit.id}; kept source text.`);
        continue;
      }
      restoredTranslations.set(unit.id, restoreProtectedTokens(translated, unit.protectedTokens));
    }

    return {
      text: applySpanTranslations(document.text, document.units, restoredTranslations),
      warnings
    };
  }
}
