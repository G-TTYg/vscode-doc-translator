import path from "node:path";
import {
  findMissingProtectedTokens,
  protectMarkdownInlineText,
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
import {
  applySpanTranslations,
  buildOrderedContext,
  createUnitId,
  detectLineEnding,
  type SpanParsedDocument,
  type SpanTranslationUnit
} from "./shared";

export interface MarkdownDocument extends SpanParsedDocument {
  readonly format: "markdown";
}

export interface MarkdownExtractionOptions {
  readonly skipMdxStructuralLines?: boolean;
}

interface LineInfo {
  readonly start: number;
  readonly end: number;
  readonly contentEnd: number;
  readonly text: string;
}

export class MarkdownAdapter implements DocumentFormatAdapter<MarkdownDocument> {
  readonly id = "markdown";
  readonly version = "0.2.0";

  canHandle(file: SourceFileInfo): boolean {
    return file.extension === ".md" || file.extension === ".markdown";
  }

  async parse(input: ParseInput): Promise<MarkdownDocument> {
    return {
      format: "markdown",
      sourcePath: input.sourcePath,
      text: input.text,
      lineEnding: detectLineEnding(input.text),
      units: extractMarkdownUnits(input.sourcePath, input.text, this.id)
    };
  }

  async extractUnits(document: MarkdownDocument): Promise<readonly TranslationUnit[]> {
    return document.units;
  }

  async buildOrderedJsonContext(
    document: MarkdownDocument,
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

  async validate(
    document: MarkdownDocument,
    translations: TranslationMap
  ): Promise<readonly ValidationIssue[]> {
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

  async reconstruct(
    document: MarkdownDocument,
    translations: TranslationMap
  ): Promise<ReconstructedDocument> {
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

export function extractMarkdownUnits(
  sourcePath: string,
  text: string,
  adapterId: string,
  options: MarkdownExtractionOptions = {}
): readonly SpanTranslationUnit[] {
  const lines = splitLines(text);
  const units: SpanTranslationUnit[] = [];
  let order = 0;
  let inFence = false;
  let inFrontmatter = false;
  let frontmatterFence: string | undefined;
  let paragraphStart: LineInfo | undefined;
  let paragraphEnd: LineInfo | undefined;

  const flushParagraph = () => {
    if (!paragraphStart || !paragraphEnd) {
      return;
    }
    const start = paragraphStart.start;
    const end = paragraphEnd.contentEnd;
    const sourceText = text.slice(start, end);
    order = pushUnit(units, {
      adapterId,
      sourcePath,
      order,
      kind: "paragraph",
      sourceText,
      start,
      end
    });
    paragraphStart = undefined;
    paragraphEnd = undefined;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.text.trim();

    if (index === 0 && (trimmed === "---" || trimmed === "+++")) {
      inFrontmatter = true;
      frontmatterFence = trimmed;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === frontmatterFence) {
        inFrontmatter = false;
      }
      continue;
    }

    if (/^(```|~~~)/.test(trimmed)) {
      flushParagraph();
      inFence = !inFence;
      continue;
    }
    if (inFence || trimmed.length === 0 || /^ {4,}\S/.test(line.text)) {
      flushParagraph();
      continue;
    }

    if (options.skipMdxStructuralLines && isMdxStructuralLine(trimmed)) {
      flushParagraph();
      continue;
    }

    if (isTableSeparator(trimmed)) {
      flushParagraph();
      continue;
    }

    if (isTableRow(line.text)) {
      flushParagraph();
      const cells = tableCellSpans(line);
      for (const cell of cells) {
        const cellText = text.slice(cell.start, cell.end);
        if (cellText.trim().length === 0) {
          continue;
        }
        order = pushUnit(units, {
          adapterId,
          sourcePath,
          order,
          kind: "tableCell",
          sourceText: cellText,
          start: cell.start,
          end: cell.end
        });
      }
      continue;
    }

    const headingMatch = /^(#{1,6}\s+)(.+?)\s*(#*\s*)$/.exec(line.text.slice(0, line.contentEnd - line.start));
    if (headingMatch) {
      flushParagraph();
      const prefixLength = headingMatch[1].length;
      const trailingLength = headingMatch[3].length;
      const start = line.start + prefixLength;
      const end = line.contentEnd - trailingLength;
      order = pushUnit(units, {
        adapterId,
        sourcePath,
        order,
        kind: "heading",
        sourceText: text.slice(start, end),
        start,
        end
      });
      continue;
    }

    const listMatch = /^(\s*(?:[-+*]|\d+[.)])\s+)(.+)$/.exec(line.text.slice(0, line.contentEnd - line.start));
    if (listMatch) {
      flushParagraph();
      const start = line.start + listMatch[1].length;
      const end = line.contentEnd;
      order = pushUnit(units, {
        adapterId,
        sourcePath,
        order,
        kind: "listItem",
        sourceText: text.slice(start, end),
        start,
        end
      });
      continue;
    }

    if (!paragraphStart) {
      paragraphStart = line;
    }
    paragraphEnd = line;
  }

  flushParagraph();
  return units;
}

function pushUnit(
  units: SpanTranslationUnit[],
  input: {
    readonly adapterId: string;
    readonly sourcePath: string;
    readonly order: number;
    readonly kind: SpanTranslationUnit["kind"];
    readonly sourceText: string;
    readonly start: number;
    readonly end: number;
  }
): number {
  const protectedText = protectMarkdownInlineText(input.sourceText, input.order);
  units.push({
    id: createUnitId({
      adapterId: input.adapterId,
      sourcePath: path.basename(input.sourcePath),
      order: input.order,
      kind: input.kind,
      sourceText: protectedText.text
    }),
    order: input.order,
    kind: input.kind,
    sourceText: protectedText.text,
    protectedTokens: protectedText.tokens,
    span: {
      start: input.start,
      end: input.end
    }
  });
  return input.order + 1;
}

function splitLines(text: string): readonly LineInfo[] {
  const lines: LineInfo[] = [];
  const pattern = /.*(?:\r\n|\n|\r|$)/g;

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined || match[0] === "") {
      continue;
    }
    const raw = match[0];
    const newlineLength = raw.endsWith("\r\n") ? 2 : raw.endsWith("\n") || raw.endsWith("\r") ? 1 : 0;
    lines.push({
      start: match.index,
      end: match.index + raw.length,
      contentEnd: match.index + raw.length - newlineLength,
      text: raw
    });
  }

  return lines;
}

function isTableRow(line: string): boolean {
  return line.includes("|");
}

function isTableSeparator(trimmed: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
}

function tableCellSpans(line: LineInfo): readonly { start: number; end: number }[] {
  const content = line.text.slice(0, line.contentEnd - line.start);
  const spans: { start: number; end: number }[] = [];
  let cellStart = 0;

  for (let i = 0; i <= content.length; i += 1) {
    if (i !== content.length && content[i] !== "|") {
      continue;
    }
    const rawStart = cellStart;
    const rawEnd = i;
    const cellText = content.slice(rawStart, rawEnd);
    const leading = cellText.length - cellText.trimStart().length;
    const trailing = cellText.length - cellText.trimEnd().length;
    const start = line.start + rawStart + leading;
    const end = line.start + rawEnd - trailing;
    if (end > start) {
      spans.push({ start, end });
    }
    cellStart = i + 1;
  }

  return spans;
}

function isMdxStructuralLine(trimmed: string): boolean {
  return (
    /^import\s/.test(trimmed) ||
    /^export\s/.test(trimmed) ||
    trimmed.startsWith("<") ||
    trimmed.startsWith("{") ||
    trimmed.endsWith("/>")
  );
}
