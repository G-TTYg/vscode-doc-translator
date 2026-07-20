import type { TranslateRequest, TranslatedUnit } from "../domain/types";
import { fetchWithRetry, readErrorBody } from "./http";
import {
  type LlmTranslationAttempt,
  createLlmProviderCacheIdentity,
  createTranslationSystemPrompt,
  safeEndpointLabel
} from "./aiTranslationHarness";
import {
  StructuredLlmProvider,
  type StructuredLlmProviderOptions,
  type OrderedContextChunk,
  createAiTranslationPayload,
  createSourceTextMap,
  parseTranslations,
  trimTrailingSlash
} from "./structuredLlmProvider";

export interface OpenAiCompatibleProviderOptions extends StructuredLlmProviderOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetch?: typeof fetch;
}

export class OpenAiCompatibleProvider extends StructuredLlmProvider {
  readonly id = "openai-compatible";
  readonly displayName = "OpenAI-compatible Chat Completions";
  readonly modelOrApiVersion: string;
  readonly endpointLabel: string;
  readonly cacheIdentity: string;

  constructor(private readonly providerOptions: OpenAiCompatibleProviderOptions) {
    super(providerOptions);
    requireOption(providerOptions.endpoint, "OpenAI-compatible endpoint");
    requireOption(providerOptions.apiKey, "OpenAI-compatible API key");
    requireOption(providerOptions.model, "OpenAI-compatible model");
    this.modelOrApiVersion = providerOptions.model;
    this.endpointLabel = safeEndpointLabel(providerOptions.endpoint);
    this.cacheIdentity = createLlmProviderCacheIdentity({
      providerId: this.id,
      endpoint: providerOptions.endpoint,
      model: providerOptions.model,
      capabilities: this.capabilities
    });
  }

  protected async requestChunkTranslations(
    request: TranslateRequest,
    chunk: OrderedContextChunk,
    attempt: LlmTranslationAttempt
  ): Promise<readonly TranslatedUnit[]> {
    const response = await fetchWithRetry(
      this.providerOptions.fetch ?? fetch,
      `${trimTrailingSlash(this.providerOptions.endpoint)}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.providerOptions.apiKey}`
        },
        body: JSON.stringify({
          model: this.providerOptions.model,
          temperature: 0,
          response_format: { type: "json_object" },
          max_tokens: this.capabilities.maxOutputTokens,
          messages: [
            {
              role: "system",
              content: createTranslationSystemPrompt(request.targetLanguage, attempt)
            },
            {
              role: "user",
              content: JSON.stringify(
                createAiTranslationPayload({
                  attempt,
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

function requireOption(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }
}

export {
  chunkOrderedDocumentContext,
  createAiTranslationPayload,
  parseTranslations
} from "./structuredLlmProvider";
export type { AiSegmentationBudget, OrderedContextChunk } from "./structuredLlmProvider";
