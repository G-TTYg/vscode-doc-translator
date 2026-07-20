import type {
  OrderedDocumentContext,
  OrderedContextUnit,
  TranslateRequest,
  TranslateResult,
  TranslationProvider,
  TranslatedUnit
} from "../domain/types";
import {
  AI_TRANSLATION_HARNESS_VERSION,
  type LlmTranslationAttempt,
  inspectProtectedTokens,
  inspectUnchangedTranslations,
  looksLikeTargetLanguage,
  normalizeProtectedTokenFormatting,
  protectedTokenWarning,
  replaceTranslations,
  shouldRepairUnchangedTranslations,
  unchangedTranslationWarning
} from "./aiTranslationHarness";

export interface StructuredLlmProviderOptions {
  readonly maxContextCharacters?: number;
  readonly maxContextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly charactersPerToken?: number;
}

const DEFAULT_MAX_CONTEXT_CHARACTERS = 60000;
const DEFAULT_MAX_CONTEXT_TOKENS = 128000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_CHARACTERS_PER_TOKEN = 4;
const PROMPT_OVERHEAD_TOKENS = 1200;
const TRANSLATION_OUTPUT_EXPANSION = 1.8;

export const TRANSLATION_RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "One exact id from translationUnitIds." },
          text: {
            type: "string",
            description: "Target-language translation with protected tokens preserved exactly."
          },
          skip: {
            type: "boolean",
            description:
              "True only when the unit has no translatable natural language or is already in the target language."
          }
        },
        required: ["id", "text", "skip"]
      }
    }
  },
  required: ["translations"]
} as const;

export abstract class StructuredLlmProvider implements TranslationProvider {
  abstract readonly id: string;
  abstract readonly displayName: string;
  readonly capabilities;
  readonly harnessVersion = AI_TRANSLATION_HARNESS_VERSION;

  protected constructor(protected readonly options: StructuredLlmProviderOptions) {
    this.capabilities = {
      requestPackaging: "ordered-json-context" as const,
      supportsStructuredJsonOutput: true,
      maxContextCharacters: options.maxContextCharacters,
      maxContextTokens: options.maxContextTokens ?? inferContextTokensFromLegacyCharacters(options),
      maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
    };
  }

  async translateBatch(request: TranslateRequest): Promise<TranslateResult> {
    if (!request.orderedContext) {
      throw new Error(`${this.displayName} requires ordered JSON context.`);
    }

    if (
      request.sourceLanguage === "auto" &&
      looksLikeTargetLanguage(
        request.orderedContext.units.map((unit) => unit.sourceText).join("\n"),
        request.targetLanguage,
        "document"
      )
    ) {
      return {
        translations: request.orderedContext.units.map((unit) => ({
          id: unit.id,
          text: unit.sourceText,
          skipped: true
        })),
        warnings: [
          `${this.displayName} detected that the document already uses ${request.targetLanguage}; ` +
            "the source content was preserved without an API request."
        ],
        requestCount: 0
      };
    }

    const chunks = chunkOrderedDocumentContext(
      request.orderedContext,
      createSegmentationBudget(this.options)
    );
    const translations: TranslatedUnit[] = [];
    const warnings: string[] = [];
    let requestCount = 0;

    for (const chunk of chunks) {
      if (chunk.oversizedUnitIds.length > 0) {
        warnings.push(
          `Chunk contains unit(s) exceeding the configured LLM input/output token budget: ${chunk.oversizedUnitIds.join(", ")}`
        );
      }
      const chunkResult = await this.translateContextChunk(request, chunk);
      translations.push(...chunkResult.translations);
      warnings.push(...chunkResult.warnings);
      requestCount += chunkResult.requestCount;
    }

    return {
      translations,
      warnings,
      requestCount
    };
  }

  private async translateContextChunk(
    request: TranslateRequest,
    chunk: OrderedContextChunk
  ): Promise<ChunkTranslationResult> {
    let firstAttempt: readonly TranslatedUnit[];
    let requestCount = 1;
    const warnings: string[] = [];
    try {
      firstAttempt = await this.requestChunkTranslations(request, chunk, "initial");
    } catch (error) {
      if (!(error instanceof LlmResponseFormatError)) {
        throw error;
      }
      warnings.push(`${this.displayName} returned an invalid translation object; retrying the chunk.`);
      firstAttempt = await this.requestChunkTranslations(request, chunk, "response-format-repair");
      requestCount += 1;
    }
    warnings.push(...collectChunkWarnings(firstAttempt, chunk.translationUnitIds, this.displayName));
    const missingIds = missingTranslationUnitIds(chunk.translationUnitIds, firstAttempt);
    let translations: readonly TranslatedUnit[] = firstAttempt;

    if (missingIds.length > 0) {
      warnings.push(
        `${this.displayName} omitted translation id(s), retrying missing unit(s): ${missingIds.join(", ")}`
      );
      const repairTranslations = await this.requestChunkTranslations(
        request,
        withTranslationUnitIds(chunk, missingIds),
        "missing-repair"
      );
      requestCount += 1;
      warnings.push(...collectChunkWarnings(repairTranslations, missingIds, this.displayName));
      translations = [...firstAttempt, ...repairTranslations];
      const stillMissingIds = missingTranslationUnitIds(chunk.translationUnitIds, translations);
      if (stillMissingIds.length > 0) {
        warnings.push(
          `${this.displayName} still did not return translation id(s) after retry: ${stillMissingIds.join(", ")}`
        );
        translations = preserveSourceForUnits(
          orderedKnownTranslations(translations, chunk.translationUnitIds),
          chunk.context.units,
          stillMissingIds,
          chunk.translationUnitIds
        );
        warnings.push(
          `${this.displayName} kept source text for ${stillMissingIds.length} omitted unit(s); ` +
            "the document translation continued."
        );
      }
    }

    let orderedTranslations = normalizeProtectedTokenFormatting({
      contextUnits: chunk.context.units,
      translations: orderedKnownTranslations(translations, chunk.translationUnitIds)
    });
    let protectedTokenRepairAttempted = false;

    const repairProtectedTokens = async (report: ReturnType<typeof inspectProtectedTokens>) => {
      warnings.push(protectedTokenWarning(report, this.displayName, "retrying"));
      const repairTranslations = await this.requestChunkTranslations(
        request,
        withFocusedTranslationUnits(chunk, report.affectedUnitIds),
        "protected-token-repair"
      );
      requestCount += 1;
      protectedTokenRepairAttempted = true;
      warnings.push(
        ...collectChunkWarnings(repairTranslations, report.affectedUnitIds, this.displayName)
      );
      const omittedRepairIds = missingTranslationUnitIds(
        report.affectedUnitIds,
        repairTranslations
      );
      if (omittedRepairIds.length > 0) {
        warnings.push(
          `${this.displayName} omitted protected-token repair id(s): ${omittedRepairIds.join(", ")}`
        );
      }
      orderedTranslations = normalizeProtectedTokenFormatting({
        contextUnits: chunk.context.units,
        translations: replaceTranslations(
          orderedTranslations,
          repairTranslations,
          chunk.translationUnitIds
        )
      });
    };

    const protectedTokenReport = inspectProtectedTokens({
      expectedUnitIds: chunk.translationUnitIds,
      contextUnits: chunk.context.units,
      translations: orderedTranslations
    });
    if (protectedTokenReport.violationCount > 0) {
      await repairProtectedTokens(protectedTokenReport);
    }

    const unchangedReport = inspectUnchangedTranslations({
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      expectedUnitIds: chunk.translationUnitIds,
      contextUnits: chunk.context.units,
      translations: orderedTranslations
    });

    if (shouldRepairUnchangedTranslations(unchangedReport)) {
      warnings.push(unchangedTranslationWarning(unchangedReport, this.displayName, "retrying"));
      const repairTranslations = await this.requestChunkTranslations(
        request,
        withTranslationUnitIds(chunk, unchangedReport.unchangedUnitIds),
        "unchanged-repair"
      );
      requestCount += 1;
      warnings.push(
        ...collectChunkWarnings(
          repairTranslations,
          unchangedReport.unchangedUnitIds,
          this.displayName
        )
      );
      const omittedRepairIds = missingTranslationUnitIds(
        unchangedReport.unchangedUnitIds,
        repairTranslations
      );
      if (omittedRepairIds.length > 0) {
        warnings.push(
          `${this.displayName} omitted unchanged-text repair id(s): ${omittedRepairIds.join(", ")}`
        );
      }
      orderedTranslations = normalizeProtectedTokenFormatting({
        contextUnits: chunk.context.units,
        translations: replaceTranslations(
          orderedTranslations,
          repairTranslations,
          chunk.translationUnitIds
        )
      });
    }

    let finalProtectedTokenReport = inspectProtectedTokens({
      expectedUnitIds: chunk.translationUnitIds,
      contextUnits: chunk.context.units,
      translations: orderedTranslations
    });
    if (finalProtectedTokenReport.violationCount > 0 && !protectedTokenRepairAttempted) {
      await repairProtectedTokens(finalProtectedTokenReport);
      finalProtectedTokenReport = inspectProtectedTokens({
        expectedUnitIds: chunk.translationUnitIds,
        contextUnits: chunk.context.units,
        translations: orderedTranslations
      });
    }
    if (finalProtectedTokenReport.violationCount > 0) {
      warnings.push(
        protectedTokenWarning(finalProtectedTokenReport, this.displayName, "remaining")
      );
      // Preserve structure locally instead of discarding successful translations from other units.
      orderedTranslations = preserveSourceForUnits(
        orderedTranslations,
        chunk.context.units,
        finalProtectedTokenReport.affectedUnitIds,
        chunk.translationUnitIds
      );
      warnings.push(
        `${this.displayName} kept source text for ${finalProtectedTokenReport.affectedUnitIds.length} ` +
          "unit(s) whose protected content could not be repaired; the rest of the document was translated."
      );
    }

    const finalUnchangedReport = inspectUnchangedTranslations({
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      expectedUnitIds: chunk.translationUnitIds,
      contextUnits: chunk.context.units,
      translations: orderedTranslations
    });
    if (finalUnchangedReport.unchangedUnitIds.length > 0) {
      warnings.push(
        unchangedTranslationWarning(finalUnchangedReport, this.displayName, "remaining")
      );
      orderedTranslations = preserveSourceForUnits(
        orderedTranslations,
        chunk.context.units,
        finalUnchangedReport.unchangedUnitIds,
        chunk.translationUnitIds
      );
      warnings.push(
        `${this.displayName} kept source text for ${finalUnchangedReport.unchangedUnitIds.length} ` +
          "unit(s) that remained unchanged after retry; the document translation continued."
      );
    }

    return {
      translations: orderedTranslations,
      warnings,
      requestCount
    };
  }

  protected abstract requestChunkTranslations(
    request: TranslateRequest,
    chunk: OrderedContextChunk,
    attempt: LlmTranslationAttempt
  ): Promise<readonly TranslatedUnit[]>;
}

export interface OrderedContextChunk {
  readonly context: OrderedDocumentContext;
  readonly translationUnitIds: readonly string[];
  readonly targetRange: {
    readonly startOrder: number;
    readonly endOrder: number;
  };
  readonly oversizedUnitIds: readonly string[];
}

export interface AiTranslationPayload {
  readonly attempt: LlmTranslationAttempt;
  readonly sourceLanguage: string | "auto";
  readonly targetLanguage: string;
  readonly instructions: readonly string[];
  readonly referenceDocument: AiReferenceDocument;
  readonly translationUnitIds: readonly string[];
  readonly outputSchema: {
    readonly translations: readonly [
      {
        readonly id: "one id from translationUnitIds";
        readonly text: "translated text preserving protected tokens";
        readonly skip: "true only for non-language content or text already in the target language";
      }
    ];
  };
}

export interface AiReferenceDocument {
  readonly documentId: string;
  readonly sourceLanguage: string | "auto";
  readonly targetLanguage: string;
  readonly format: string;
  readonly units: readonly {
    readonly id: string;
    readonly order: number;
    readonly kind: OrderedContextUnit["kind"];
    readonly sourceText: string;
    readonly requiredProtectedTokens: readonly string[];
    readonly protectedContent: readonly {
      readonly token: string;
      readonly originalText: string;
    }[];
  }[];
}

interface ChunkTranslationResult {
  readonly translations: readonly TranslatedUnit[];
  readonly warnings: readonly string[];
  readonly requestCount: number;
}

export function chunkOrderedDocumentContext(
  context: OrderedDocumentContext,
  budgetInput: AiSegmentationBudget | number
): readonly OrderedContextChunk[] {
  const budget =
    typeof budgetInput === "number" ? budgetFromLegacyMaxCharacters(budgetInput) : budgetInput;
  const inputBudgetTokens = availableInputTokens(budget);
  const orderedUnits = [...context.units].sort((a, b) => a.order - b.order);
  const chunks: OrderedContextChunk[] = [];
  let cursor = 0;

  while (cursor < orderedUnits.length) {
    const targetUnits = selectTargetUnits(context, orderedUnits, cursor, budget);
    const targetStart = cursor;
    const targetEnd = cursor + targetUnits.length - 1;
    const expanded = expandReferenceWindow(
      context,
      orderedUnits,
      targetStart,
      targetEnd,
      budget
    );
    const oversizedUnitIds = oversizedTargetUnitIds(context, targetUnits, budget, inputBudgetTokens);

    chunks.push({
      context: withUnits(context, expanded),
      translationUnitIds: targetUnits.map((unit) => unit.id),
      targetRange: {
        startOrder: targetUnits[0].order,
        endOrder: targetUnits[targetUnits.length - 1].order
      },
      oversizedUnitIds
    });
    cursor += targetUnits.length;
  }

  return chunks.length > 0
    ? chunks
    : [
        {
          context: withUnits(context, []),
          translationUnitIds: [],
          targetRange: { startOrder: 0, endOrder: 0 },
          oversizedUnitIds: []
        }
      ];
}

export function createAiTranslationPayload(input: {
  readonly attempt: LlmTranslationAttempt;
  readonly sourceLanguage: string | "auto";
  readonly targetLanguage: string;
  readonly referenceDocument: OrderedDocumentContext;
  readonly translationUnitIds: readonly string[];
}): AiTranslationPayload {
  return {
    attempt: input.attempt,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    instructions: [
      `Translate all natural-language content for the requested ids into ${input.targetLanguage}.`,
      "Return exactly one translations item for every id in translationUnitIds.",
      "Do not copy source wording instead of translating it.",
      "Use skip: true only for content without translatable natural language or content already in the target language.",
      "Copy every requiredProtectedTokens entry for each requested unit into its translated text exactly once.",
      "Use protectedContent only to understand the source; return its token rather than originalText.",
      "Never escape or wrap a protected token.",
      attemptInstruction(input.attempt),
      "Translate only ids from translationUnitIds; referenceDocument.units is context only.",
      "Preserve protected token strings exactly."
    ],
    referenceDocument: createAiReferenceDocument(input.referenceDocument),
    translationUnitIds: input.translationUnitIds,
    outputSchema: {
      translations: [
        {
          id: "one id from translationUnitIds",
          text: "translated text preserving protected tokens",
          skip: "true only for non-language content or text already in the target language"
        }
      ]
    }
  };
}

export interface AiSegmentationBudget {
  readonly modelMaxContextTokens: number;
  readonly maxOutputTokens: number;
  readonly charactersPerToken: number;
  readonly promptOverheadTokens: number;
  readonly outputExpansionRatio: number;
}

export function parseTranslations(
  content: string,
  sourceTextById: ReadonlyMap<string, string> = new Map()
): readonly TranslatedUnit[] {
  const parsed = parseJsonWithRecovery(content);
  const translationsValue = recoverTranslationItems(parsed, sourceTextById);

  if (!Array.isArray(translationsValue)) {
    throw new LlmResponseFormatError(
      `LLM response must contain translations for requested ids (${describeJsonShape(parsed)}).`
    );
  }

  return translationsValue.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string") {
      throw new Error("Each translation must contain a string id field.");
    }
    if (item.skip === true) {
      const sourceText = sourceTextById.get(item.id);
      if (sourceText === undefined) {
        throw new Error("Skipped translations must reference a requested id.");
      }
      return {
        id: item.id,
        text: sourceText,
        skipped: true
      };
    }
    if (typeof item.text !== "string") {
      throw new Error("Each non-skipped translation must contain a string text field.");
    }
    return {
      id: item.id,
      text: item.text
    };
  });
}

export class LlmResponseFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmResponseFormatError";
  }
}

function parseJsonWithRecovery(content: string): unknown {
  const candidates = uniqueCandidates([
    content,
    stripMarkdownFence(content),
    ...extractBalancedJsonCandidates(content)
  ]);
  const errors: string[] = [];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }
    for (const normalized of uniqueCandidates([trimmed, removeTrailingCommas(trimmed)])) {
      try {
        return JSON.parse(normalized) as unknown;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  throw new Error(
    `LLM response was not valid JSON and could not be recovered: ${errors[0] ?? "unknown parse error"}`
  );
}

function stripMarkdownFence(content: string): string {
  const match = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? content;
}

function extractBalancedJsonCandidates(content: string): readonly string[] {
  const candidates: string[] = [];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "{" && content[index] !== "[") {
      continue;
    }
    const end = findBalancedJsonEnd(content, index);
    if (end !== undefined) {
      candidates.push(content.slice(index, end + 1));
    }
  }
  return candidates;
}

function findBalancedJsonEnd(content: string, startIndex: number): number | undefined {
  const stack = [matchingCloseBracket(content[startIndex])];
  let inString = false;
  let escaped = false;

  for (let index = startIndex + 1; index < content.length; index += 1) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(matchingCloseBracket(char));
      continue;
    }
    if (char === "}" || char === "]") {
      if (stack.pop() !== char) {
        return undefined;
      }
      if (stack.length === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function matchingCloseBracket(openBracket: string): string {
  return openBracket === "{" ? "}" : "]";
}

function removeTrailingCommas(content: string): string {
  return content.replace(/,\s*([}\]])/g, "$1");
}

function uniqueCandidates(candidates: readonly string[]): readonly string[] {
  return [...new Set(candidates)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recoverTranslationItems(
  parsed: unknown,
  sourceTextById: ReadonlyMap<string, string>
): unknown {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  if (Array.isArray(parsed.translations)) {
    return parsed.translations;
  }
  if (
    typeof parsed.id === "string" &&
    sourceTextById.has(parsed.id) &&
    (typeof parsed.text === "string" || parsed.skip === true)
  ) {
    return [parsed];
  }
  const nestedMapping = recoverKnownIdMapping(parsed.translations, sourceTextById);
  if (nestedMapping) {
    return nestedMapping;
  }
  return recoverKnownIdMapping(parsed, sourceTextById);
}

function recoverKnownIdMapping(
  value: unknown,
  sourceTextById: ReadonlyMap<string, string>
): readonly Record<string, unknown>[] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const recovered = Object.entries(value).flatMap(([id, translation]) => {
    if (!sourceTextById.has(id)) {
      return [];
    }
    if (typeof translation === "string") {
      return [{ id, text: translation, skip: false }];
    }
    if (isRecord(translation) && typeof translation.text === "string") {
      return [{ id, text: translation.text, skip: translation.skip === true }];
    }
    return [];
  });
  return recovered.length > 0 ? recovered : undefined;
}

function describeJsonShape(value: unknown): string {
  if (Array.isArray(value)) {
    return `array length ${value.length}`;
  }
  if (!isRecord(value)) {
    return typeof value;
  }
  const fields = Object.entries(value)
    .slice(0, 8)
    .map(([key, fieldValue]) => `${key}:${Array.isArray(fieldValue) ? "array" : typeof fieldValue}`);
  return `object fields ${fields.join(", ") || "none"}`;
}

export function createSourceTextMap(
  units: readonly OrderedContextUnit[]
): ReadonlyMap<string, string> {
  return new Map(units.map((unit) => [unit.id, unit.sourceText]));
}

function missingTranslationUnitIds(
  expectedIds: readonly string[],
  translations: readonly TranslatedUnit[]
): readonly string[] {
  const seen = new Set(translations.map((translation) => translation.id));
  return expectedIds.filter((id) => !seen.has(id));
}

function collectChunkWarnings(
  translations: readonly TranslatedUnit[],
  expectedIds: readonly string[],
  providerName: string
): readonly string[] {
  const warnings: string[] = [];
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  for (const translation of translations) {
    if (!expected.has(translation.id)) {
      warnings.push(`${providerName} returned unknown translation id: ${translation.id}`);
    }
    if (seen.has(translation.id)) {
      warnings.push(`${providerName} returned duplicate translation id: ${translation.id}`);
    }
    seen.add(translation.id);
  }
  return warnings;
}

function orderedKnownTranslations(
  translations: readonly TranslatedUnit[],
  expectedIds: readonly string[]
): readonly TranslatedUnit[] {
  const expected = new Set(expectedIds);
  const byId = new Map<string, TranslatedUnit>();
  for (const translation of translations) {
    if (expected.has(translation.id) && !byId.has(translation.id)) {
      byId.set(translation.id, translation);
    }
  }
  return expectedIds.flatMap((id) => {
    const translation = byId.get(id);
    return translation ? [translation] : [];
  });
}

function withTranslationUnitIds(
  chunk: OrderedContextChunk,
  translationUnitIds: readonly string[]
): OrderedContextChunk {
  return {
    ...chunk,
    translationUnitIds
  };
}

function withFocusedTranslationUnits(
  chunk: OrderedContextChunk,
  translationUnitIds: readonly string[]
): OrderedContextChunk {
  const requested = new Set(translationUnitIds);
  return {
    ...chunk,
    context: withUnits(
      chunk.context,
      chunk.context.units.filter((unit) => requested.has(unit.id))
    ),
    translationUnitIds
  };
}

function preserveSourceForUnits(
  translations: readonly TranslatedUnit[],
  contextUnits: readonly OrderedContextUnit[],
  affectedUnitIds: readonly string[],
  expectedIds: readonly string[]
): readonly TranslatedUnit[] {
  const affected = new Set(affectedUnitIds);
  const sourceById = new Map(contextUnits.map((unit) => [unit.id, unit.sourceText]));
  const replacements = affectedUnitIds.flatMap((id) => {
    const sourceText = sourceById.get(id);
    return sourceText === undefined
      ? []
      : [{ id, text: sourceText, preservedSource: true } satisfies TranslatedUnit];
  });
  return replaceTranslations(
    translations.filter((translation) => !affected.has(translation.id)),
    replacements,
    expectedIds
  );
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function withUnits(
  context: OrderedDocumentContext,
  units: readonly OrderedContextUnit[]
): OrderedDocumentContext {
  return {
    ...context,
    units
  };
}

function selectTargetUnits(
  context: OrderedDocumentContext,
  orderedUnits: readonly OrderedContextUnit[],
  startIndex: number,
  budget: AiSegmentationBudget
): readonly OrderedContextUnit[] {
  const selected: OrderedContextUnit[] = [];
  const inputBudgetTokens = availableInputTokens(budget);

  for (let index = startIndex; index < orderedUnits.length; index += 1) {
    const candidate = [...selected, orderedUnits[index]];
    const outputTokens = estimateOutputTokens(candidate, budget);
    const inputTokens = estimatePayloadTokens(context, candidate, candidate, budget);
    if (
      selected.length > 0 &&
      (outputTokens > budget.maxOutputTokens || inputTokens > inputBudgetTokens)
    ) {
      break;
    }
    selected.push(orderedUnits[index]);
    if (
      selected.length === 1 &&
      (outputTokens > budget.maxOutputTokens || inputTokens > inputBudgetTokens)
    ) {
      break;
    }
  }

  return selected;
}

function expandReferenceWindow(
  context: OrderedDocumentContext,
  orderedUnits: readonly OrderedContextUnit[],
  targetStart: number,
  targetEnd: number,
  budget: AiSegmentationBudget
): readonly OrderedContextUnit[] {
  let referenceStart = targetStart;
  let referenceEnd = targetEnd;
  let preferAfter = true;
  const inputBudgetTokens = availableInputTokens(budget);

  while (true) {
    const after = referenceEnd + 1 < orderedUnits.length ? referenceEnd + 1 : undefined;
    const before = referenceStart - 1 >= 0 ? referenceStart - 1 : undefined;
    const first = preferAfter ? after : before;
    const second = preferAfter ? before : after;
    const expanded = tryExpandReference(
      context,
      orderedUnits,
      referenceStart,
      referenceEnd,
      first,
      targetStart,
      targetEnd,
      budget,
      inputBudgetTokens
    ) ??
      tryExpandReference(
        context,
        orderedUnits,
        referenceStart,
        referenceEnd,
        second,
        targetStart,
        targetEnd,
        budget,
        inputBudgetTokens
      );

    if (!expanded) {
      break;
    }

    referenceStart = expanded.referenceStart;
    referenceEnd = expanded.referenceEnd;
    preferAfter = !preferAfter;
  }

  return orderedUnits.slice(referenceStart, referenceEnd + 1);
}

function tryExpandReference(
  context: OrderedDocumentContext,
  orderedUnits: readonly OrderedContextUnit[],
  referenceStart: number,
  referenceEnd: number,
  candidateIndex: number | undefined,
  targetStart: number,
  targetEnd: number,
  budget: AiSegmentationBudget,
  inputBudgetTokens: number
): { readonly referenceStart: number; readonly referenceEnd: number } | undefined {
  if (candidateIndex === undefined) {
    return undefined;
  }
  const nextStart = Math.min(referenceStart, candidateIndex);
  const nextEnd = Math.max(referenceEnd, candidateIndex);
  const referenceUnits = orderedUnits.slice(nextStart, nextEnd + 1);
  const targetUnits = orderedUnits.slice(targetStart, targetEnd + 1);
  if (estimatePayloadTokens(context, referenceUnits, targetUnits, budget) > inputBudgetTokens) {
    return undefined;
  }
  return { referenceStart: nextStart, referenceEnd: nextEnd };
}

function estimatePayloadTokens(
  context: OrderedDocumentContext,
  referenceUnits: readonly OrderedContextUnit[],
  targetUnits: readonly OrderedContextUnit[],
  budget: AiSegmentationBudget
): number {
  const characters = JSON.stringify(
    createAiTranslationPayload({
      attempt: "initial",
      sourceLanguage: context.sourceLanguage,
      targetLanguage: context.targetLanguage,
      referenceDocument: withUnits(context, referenceUnits),
      translationUnitIds: targetUnits.map((unit) => unit.id)
    })
  ).length;
  return estimateTokensFromCharacters(characters, budget.charactersPerToken);
}

function attemptInstruction(attempt: LlmTranslationAttempt): string {
  switch (attempt) {
    case "missing-repair":
      return "This is a completeness repair. Return every requested id that was previously omitted.";
    case "unchanged-repair":
      return "This is a quality repair. The previous response echoed source text; translate every requested id now.";
    case "protected-token-repair":
      return "This is a token repair. Preserve every required protected token exactly once while translating the surrounding text.";
    case "response-format-repair":
      return "This is a response-format repair. Return the required translations array and no alternative object shape.";
    default:
      return "This is the initial translation attempt.";
  }
}

function createAiReferenceDocument(context: OrderedDocumentContext): AiReferenceDocument {
  return {
    documentId: context.documentId,
    sourceLanguage: context.sourceLanguage,
    targetLanguage: context.targetLanguage,
    format: context.format,
    units: context.units.map((unit) => ({
      id: unit.id,
      order: unit.order,
      kind: unit.kind,
      sourceText: unit.sourceText,
      requiredProtectedTokens: unit.protectedTokens.map(({ token }) => token),
      protectedContent: unit.protectedTokens.map(({ token, value }) => ({
        token,
        originalText: value
      }))
    }))
  };
}

function estimateOutputTokens(
  targetUnits: readonly OrderedContextUnit[],
  budget: AiSegmentationBudget
): number {
  const estimatedCharacters =
    64 +
    targetUnits.reduce((total, unit) => {
      return total + unit.id.length + unit.sourceText.length * budget.outputExpansionRatio + 32;
    }, 0);
  return estimateTokensFromCharacters(estimatedCharacters, budget.charactersPerToken);
}

function estimateTokensFromCharacters(characters: number, charactersPerToken: number): number {
  return Math.ceil(characters / Math.max(1, charactersPerToken));
}

function availableInputTokens(budget: AiSegmentationBudget): number {
  return Math.max(256, budget.modelMaxContextTokens - budget.maxOutputTokens - budget.promptOverheadTokens);
}

function oversizedTargetUnitIds(
  context: OrderedDocumentContext,
  targetUnits: readonly OrderedContextUnit[],
  budget: AiSegmentationBudget,
  inputBudgetTokens: number
): readonly string[] {
  return targetUnits
    .filter((unit) => {
      return (
        estimateOutputTokens([unit], budget) > budget.maxOutputTokens ||
        estimatePayloadTokens(context, [unit], [unit], budget) > inputBudgetTokens
      );
    })
    .map((unit) => unit.id);
}

function createSegmentationBudget(options: StructuredLlmProviderOptions): AiSegmentationBudget {
  return {
    modelMaxContextTokens: options.maxContextTokens ?? inferContextTokensFromLegacyCharacters(options),
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    charactersPerToken: options.charactersPerToken ?? DEFAULT_CHARACTERS_PER_TOKEN,
    promptOverheadTokens: PROMPT_OVERHEAD_TOKENS,
    outputExpansionRatio: TRANSLATION_OUTPUT_EXPANSION
  };
}

function budgetFromLegacyMaxCharacters(maxContextCharacters: number): AiSegmentationBudget {
  return {
    modelMaxContextTokens: Math.max(
      1000,
      Math.ceil(maxContextCharacters / DEFAULT_CHARACTERS_PER_TOKEN) +
        DEFAULT_MAX_OUTPUT_TOKENS +
        PROMPT_OVERHEAD_TOKENS
    ),
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    charactersPerToken: DEFAULT_CHARACTERS_PER_TOKEN,
    promptOverheadTokens: PROMPT_OVERHEAD_TOKENS,
    outputExpansionRatio: TRANSLATION_OUTPUT_EXPANSION
  };
}

function inferContextTokensFromLegacyCharacters(options: StructuredLlmProviderOptions): number {
  if (options.maxContextTokens) {
    return options.maxContextTokens;
  }
  if (options.maxContextCharacters) {
    return Math.max(
      1000,
      Math.ceil(options.maxContextCharacters / (options.charactersPerToken ?? DEFAULT_CHARACTERS_PER_TOKEN)) +
        (options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS) +
        PROMPT_OVERHEAD_TOKENS
    );
  }
  return DEFAULT_MAX_CONTEXT_TOKENS;
}
