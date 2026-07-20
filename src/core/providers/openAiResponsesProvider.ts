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
  TRANSLATION_RESPONSE_JSON_SCHEMA,
  createAiTranslationPayload,
  createSourceTextMap,
  parseTranslations,
  trimTrailingSlash
} from "./structuredLlmProvider";

export interface OpenAiResponsesProviderOptions extends StructuredLlmProviderOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetch?: typeof fetch;
}

export class OpenAiResponsesProvider extends StructuredLlmProvider {
  readonly id = "openai-responses";
  readonly displayName = "OpenAI Responses API";
  readonly modelOrApiVersion: string;
  readonly endpointLabel: string;
  readonly cacheIdentity: string;

  constructor(private readonly providerOptions: OpenAiResponsesProviderOptions) {
    super(providerOptions);
    requireOption(providerOptions.endpoint, "OpenAI endpoint");
    requireOption(providerOptions.apiKey, "OpenAI API key");
    requireOption(providerOptions.model, "OpenAI model");
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
      responsesUrl(this.providerOptions.endpoint),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.providerOptions.apiKey}`
        },
        body: JSON.stringify({
          model: this.providerOptions.model,
          instructions: createTranslationSystemPrompt(request.targetLanguage, attempt),
          input: JSON.stringify(
            createAiTranslationPayload({
              attempt,
              sourceLanguage: request.sourceLanguage,
              targetLanguage: request.targetLanguage,
              referenceDocument: chunk.context,
              translationUnitIds: chunk.translationUnitIds
            })
          ),
          max_output_tokens: this.capabilities.maxOutputTokens,
          store: false,
          text: {
            format: {
              type: "json_schema",
              name: "translation_batch",
              strict: true,
              schema: TRANSLATION_RESPONSE_JSON_SCHEMA
            }
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`OpenAI Responses API error ${response.status}: ${await readErrorBody(response)}`);
    }

    const payload = (await response.json()) as OpenAiResponsePayload;
    const content = extractOpenAiOutputText(payload);
    if (!content) {
      throw new Error(
        `OpenAI Responses API returned no output text${payload.status ? ` (status: ${payload.status})` : ""}.`
      );
    }

    return parseTranslations(content, createSourceTextMap(chunk.context.units));
  }
}

interface OpenAiResponsePayload {
  readonly status?: string;
  readonly output_text?: string | null;
  readonly output?: readonly {
    readonly type?: string;
    readonly content?: readonly { readonly type?: string; readonly text?: string }[];
  }[];
}

function extractOpenAiOutputText(payload: OpenAiResponsePayload): string | undefined {
  if (payload.output_text) {
    return payload.output_text;
  }
  const parts = (payload.output ?? []).flatMap((item) =>
    (item.content ?? [])
      .filter((content) => content.type === "output_text" && typeof content.text === "string")
      .map((content) => content.text as string)
  );
  return parts.length > 0 ? parts.join("") : undefined;
}

function responsesUrl(endpoint: string): string {
  const base = trimTrailingSlash(endpoint);
  return base.endsWith("/responses") ? base : `${base}/responses`;
}

function requireOption(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }
}
