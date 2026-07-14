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

    for (const chunk of chunks) {
      if (chunk.oversizedUnitIds.length > 0) {
        warnings.push(
          `Chunk contains unit(s) exceeding the configured LLM input/output token budget: ${chunk.oversizedUnitIds.join(", ")}`
        );
      }
      const chunkTranslations = await this.translateContextChunk(request, chunk);
      translations.push(...chunkTranslations);
    }

    return {
      translations,
      warnings,
      requestCount: chunks.length
    };
  }

  private async translateContextChunk(
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
                "You are a document translation engine. Use referenceDocument only for context. Translate only units whose ids are listed in translationUnitIds. Preserve protected token strings exactly. Return only valid JSON with a translations array of {id,text}. Do not render Markdown or a final document."
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

    const parsed = parseTranslations(content);
    return parsed;
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
  readonly referenceDocument: OrderedDocumentContext;
  readonly translationUnitIds: readonly string[];
  readonly outputSchema: {
    readonly translations: readonly [
      {
        readonly id: "one id from translationUnitIds";
        readonly text: "translated text preserving protected tokens";
      }
    ];
  };
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
    referenceDocument: input.referenceDocument,
    translationUnitIds: input.translationUnitIds,
    outputSchema: {
      translations: [
        {
          id: "one id from translationUnitIds",
          text: "translated text preserving protected tokens"
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

export function parseTranslations(content: string): readonly TranslatedUnit[] {
  const parsed = JSON.parse(content) as { translations?: unknown };
  if (!Array.isArray(parsed.translations)) {
    throw new Error("OpenAI-compatible API response must contain a translations array.");
  }

  return parsed.translations.map((item) => {
    const translation = item as { id?: unknown; text?: unknown };
    if (typeof translation.id !== "string" || typeof translation.text !== "string") {
      throw new Error("Each translation must contain string id and text fields.");
    }
    return {
      id: translation.id,
      text: translation.text
    };
  });
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
