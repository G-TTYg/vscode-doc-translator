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

export interface GeminiProviderOptions extends StructuredLlmProviderOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetch?: typeof fetch;
}

export class GeminiProvider extends StructuredLlmProvider {
  readonly id = "gemini";
  readonly displayName = "Gemini GenerateContent API";

  constructor(private readonly providerOptions: GeminiProviderOptions) {
    super(providerOptions);
    requireOption(providerOptions.endpoint, "Gemini endpoint");
    requireOption(providerOptions.apiKey, "Gemini API key");
    requireOption(providerOptions.model, "Gemini model");
  }

  protected async requestChunkTranslations(
    request: TranslateRequest,
    chunk: OrderedContextChunk
  ): Promise<readonly TranslatedUnit[]> {
    const response = await fetchWithRetry(
      this.providerOptions.fetch ?? fetch,
      generateContentUrl(this.providerOptions.endpoint, this.providerOptions.model),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.providerOptions.apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: TRANSLATION_SYSTEM_PROMPT }]
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: JSON.stringify(
                    createAiTranslationPayload({
                      sourceLanguage: request.sourceLanguage,
                      targetLanguage: request.targetLanguage,
                      referenceDocument: chunk.context,
                      translationUnitIds: chunk.translationUnitIds
                    })
                  )
                }
              ]
            }
          ],
          generationConfig: {
            maxOutputTokens: this.capabilities.maxOutputTokens,
            responseMimeType: "application/json",
            responseJsonSchema: TRANSLATION_RESPONSE_JSON_SCHEMA
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error ${response.status}: ${await readErrorBody(response)}`);
    }

    const payload = (await response.json()) as {
      candidates?: readonly {
        content?: { parts?: readonly { text?: string; thought?: boolean }[] };
        finishReason?: string;
      }[];
      promptFeedback?: { blockReason?: string };
    };
    const candidate = payload.candidates?.[0];
    const content = (candidate?.content?.parts ?? [])
      .filter((part) => !part.thought && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");
    if (!content) {
      const reason = candidate?.finishReason ?? payload.promptFeedback?.blockReason;
      throw new Error(`Gemini API returned no text content${reason ? ` (reason: ${reason})` : ""}.`);
    }

    return parseTranslations(content, createSourceTextMap(chunk.context.units));
  }
}

function generateContentUrl(endpoint: string, model: string): string {
  const modelPath = normalizeModelPath(model)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${trimTrailingSlash(endpoint)}/${modelPath}:generateContent`;
}

function normalizeModelPath(model: string): string {
  if (model.startsWith("models/") || model.startsWith("tunedModels/")) {
    return model;
  }
  return `models/${model}`;
}

function requireOption(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }
}
