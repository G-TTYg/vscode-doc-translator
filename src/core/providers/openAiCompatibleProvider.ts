import type {
  OrderedDocumentContext,
  OrderedContextUnit,
  TranslateRequest,
  TranslateResult,
  TranslationProvider,
  TranslatedUnit
} from "../domain/types";
import { fetchWithRetry, readErrorBody } from "./http";

export interface OpenAiCompatibleProviderOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly maxContextCharacters?: number;
  readonly maxContextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly charactersPerToken?: number;
  readonly fetch?: typeof fetch;
}

const DEFAULT_MAX_CONTEXT_CHARACTERS = 60000;
const DEFAULT_MAX_CONTEXT_TOKENS = 128000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_CHARACTERS_PER_TOKEN = 4;
const PROMPT_OVERHEAD_TOKENS = 1200;
const TRANSLATION_OUTPUT_EXPANSION = 1.8;

export class OpenAiCompatibleProvider implements TranslationProvider {
  readonly id = "openai-compatible";
  readonly displayName = "OpenAI-compatible LLM";
  readonly capabilities;

  constructor(private readonly options: OpenAiCompatibleProviderOptions) {
    if (!options.endpoint) {
      throw new Error("OpenAI-compatible endpoint is required.");
    }
    if (!options.apiKey) {
      throw new Error("OpenAI-compatible API key is required.");
    }
    if (!options.model) {
      throw new Error("OpenAI-compatible model is required.");
    }
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
      throw new Error("OpenAI-compatible provider requires ordered JSON context.");
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
    const firstAttempt = await this.requestChunkTranslations(request, chunk);
    const warnings: string[] = collectChunkWarnings(firstAttempt, chunk.translationUnitIds);
    const missingIds = missingTranslationUnitIds(chunk.translationUnitIds, firstAttempt);
    let requestCount = 1;
    let translations = firstAttempt;

    if (missingIds.length > 0) {
      warnings.push(
        `OpenAI-compatible provider omitted translation id(s), retrying missing unit(s): ${missingIds.join(", ")}`
      );
      const repairTranslations = await this.requestChunkTranslations(
        request,
        withTranslationUnitIds(chunk, missingIds)
      );
      requestCount += 1;
      warnings.push(...collectChunkWarnings(repairTranslations, missingIds));
      translations = [...firstAttempt, ...repairTranslations];
      const stillMissingIds = missingTranslationUnitIds(chunk.translationUnitIds, translations);
      if (stillMissingIds.length > 0) {
        warnings.push(
          `OpenAI-compatible provider still did not return translation id(s) after retry: ${stillMissingIds.join(", ")}`
        );
      }
    }

    return {
      translations: orderedKnownTranslations(translations, chunk.translationUnitIds),
      warnings,
      requestCount
    };
  }

  private async requestChunkTranslations(
    request: TranslateRequest,
    chunk: OrderedContextChunk
  ): Promise<readonly TranslatedUnit[]> {
    const fetchImpl = this.options.fetch ?? fetch;
    const response = await fetchWithRetry(
      fetchImpl,
      `${trimTrailingSlash(this.options.endpoint)}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiKey}`
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          response_format: { type: "json_object" },
          max_tokens: this.capabilities.maxOutputTokens,
          messages: [
            {
              role: "system",
              content:
                "You are a document translation engine. Use referenceDocument only for context. Translate only units whose ids are listed in translationUnitIds. Return exactly one translations item for every id in translationUnitIds; never omit an id. Preserve protected token strings exactly. If a unit should remain unchanged, return {\"id\":\"...\",\"skip\":true} for that id instead of omitting it. Otherwise return {\"id\":\"...\",\"text\":\"...\"}. Return only a valid JSON object with a translations array. Do not wrap JSON in Markdown fences or prose. Do not render Markdown or a final document."
            },
            {
              role: "user",
              content: JSON.stringify(
                createAiTranslationPayload({
                  sourceLanguage: request.sourceLanguage,
                  targetLanguage: request.targetLanguage,
                  referenceDocument: chunk.context,
                  translationUnitIds: chunk.translationUnitIds
                })
              )
            }
          ]
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `OpenAI-compatible API error ${response.status}: ${await readErrorBody(response)}`
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI-compatible API returned no message content.");
    }

    return parseTranslations(content, createSourceTextMap(chunk.context.units));
  }
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
  readonly sourceLanguage: string | "auto";
  readonly targetLanguage: string;
  readonly instructions: readonly string[];
  readonly referenceDocument: OrderedDocumentContext;
  readonly translationUnitIds: readonly string[];
  readonly outputSchema: {
    readonly translations: readonly [
      {
        readonly id: "one id from translationUnitIds";
        readonly text: "translated text preserving protected tokens";
        readonly skip: "optional true only when the source text should remain unchanged";
      }
    ];
  };
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
  readonly sourceLanguage: string | "auto";
  readonly targetLanguage: string;
  readonly referenceDocument: OrderedDocumentContext;
  readonly translationUnitIds: readonly string[];
}): AiTranslationPayload {
  return {
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    instructions: [
      "Return exactly one translations item for every id in translationUnitIds.",
      "Do not omit any id. If no translation is needed, include that id with skip: true.",
      "Translate only ids from translationUnitIds; referenceDocument.units is context only.",
      "Preserve protected token strings exactly."
    ],
    referenceDocument: input.referenceDocument,
    translationUnitIds: input.translationUnitIds,
    outputSchema: {
      translations: [
        {
          id: "one id from translationUnitIds",
          text: "translated text preserving protected tokens",
          skip: "optional true only when the source text should remain unchanged"
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
  const translationsValue = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed)
      ? parsed.translations
      : undefined;

  if (!Array.isArray(translationsValue)) {
    throw new Error("OpenAI-compatible API response must contain a translations array.");
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
        text: sourceText
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
    `OpenAI-compatible API response was not valid JSON and could not be recovered: ${errors[0] ?? "unknown parse error"}`
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

function createSourceTextMap(units: readonly OrderedContextUnit[]): ReadonlyMap<string, string> {
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
  expectedIds: readonly string[]
): readonly string[] {
  const warnings: string[] = [];
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  for (const translation of translations) {
    if (!expected.has(translation.id)) {
      warnings.push(`OpenAI-compatible provider returned unknown translation id: ${translation.id}`);
    }
    if (seen.has(translation.id)) {
      warnings.push(`OpenAI-compatible provider returned duplicate translation id: ${translation.id}`);
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

function trimTrailingSlash(value: string): string {
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
      sourceLanguage: context.sourceLanguage,
      targetLanguage: context.targetLanguage,
      referenceDocument: withUnits(context, referenceUnits),
      translationUnitIds: targetUnits.map((unit) => unit.id)
    })
  ).length;
  return estimateTokensFromCharacters(characters, budget.charactersPerToken);
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

function createSegmentationBudget(options: OpenAiCompatibleProviderOptions): AiSegmentationBudget {
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

function inferContextTokensFromLegacyCharacters(options: OpenAiCompatibleProviderOptions): number {
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
