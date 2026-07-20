import type { TranslateRequest, TranslatedUnit } from "../domain/types";
import { fetchWithRetry, readErrorBody } from "./http";
import {
  StructuredLlmProvider,
  type StructuredLlmProviderOptions,
  type OrderedContextChunk,
  TRANSLATION_RESPONSE_JSON_SCHEMA,
  TRANSLATION_SYSTEM_PROMPT,
  createAiTranslationPayload,
  createSourceTextMap,
  parseTranslations,
  trimTrailingSlash
} from "./structuredLlmProvider";

export interface AnthropicProviderOptions extends StructuredLlmProviderOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetch?: typeof fetch;
}

export class AnthropicProvider extends StructuredLlmProvider {
  readonly id = "anthropic";
  readonly displayName = "Anthropic Messages API";

  constructor(private readonly providerOptions: AnthropicProviderOptions) {
    super(providerOptions);
    requireOption(providerOptions.endpoint, "Anthropic endpoint");
    requireOption(providerOptions.apiKey, "Anthropic API key");
    requireOption(providerOptions.model, "Anthropic model");
  }

  protected async requestChunkTranslations(
    request: TranslateRequest,
    chunk: OrderedContextChunk
  ): Promise<readonly TranslatedUnit[]> {
    const response = await fetchWithRetry(
      this.providerOptions.fetch ?? fetch,
      messagesUrl(this.providerOptions.endpoint),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.providerOptions.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: this.providerOptions.model,
          max_tokens: this.capabilities.maxOutputTokens,
          system: TRANSLATION_SYSTEM_PROMPT,
          messages: [
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
          ],
          output_config: {
            format: {
              type: "json_schema",
              schema: TRANSLATION_RESPONSE_JSON_SCHEMA
            }
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Anthropic API error ${response.status}: ${await readErrorBody(response)}`);
    }

    const payload = (await response.json()) as {
      content?: readonly { type?: string; text?: string }[];
      stop_reason?: string;
    };
    const content = (payload.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");
    if (!content) {
      throw new Error(
        `Anthropic API returned no text content${payload.stop_reason ? ` (stop reason: ${payload.stop_reason})` : ""}.`
      );
    }

    return parseTranslations(content, createSourceTextMap(chunk.context.units));
  }
}

function messagesUrl(endpoint: string): string {
  const base = trimTrailingSlash(endpoint);
  if (base.endsWith("/v1/messages")) {
    return base;
  }
  return base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
}

function requireOption(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }
}
