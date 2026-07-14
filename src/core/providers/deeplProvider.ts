import type {
  TranslateRequest,
  TranslateResult,
  TranslationProvider,
  TranslatedUnit
} from "../domain/types";
import { fetchWithRetry, readErrorBody } from "./http";
import { assertSegmentedRequest, chunkTranslationUnits, createTranslatedUnits } from "./segmentedBatch";

export interface DeepLProviderOptions {
  readonly apiKey: string;
  readonly endpoint?: string;
  readonly maxBatchCharacters?: number;
  readonly fetch?: typeof fetch;
}

const DEFAULT_MAX_BATCH_CHARACTERS = 120000;

export class DeepLProvider implements TranslationProvider {
  readonly id = "deepl";
  readonly displayName = "DeepL";
  readonly capabilities;

  constructor(private readonly options: DeepLProviderOptions) {
    if (!options.apiKey) {
      throw new Error("DeepL API key is required.");
    }
    this.capabilities = {
      requestPackaging: "segmented-units" as const,
      maxBatchCharacters: options.maxBatchCharacters ?? DEFAULT_MAX_BATCH_CHARACTERS,
      supportsStructuredJsonOutput: false,
      supportsGlossary: true
    };
  }

  async translateBatch(request: TranslateRequest): Promise<TranslateResult> {
    assertSegmentedRequest(request, this.id);
    const batches = chunkTranslationUnits(
      request.units,
      this.capabilities.maxBatchCharacters ?? DEFAULT_MAX_BATCH_CHARACTERS
    );
    const translations: TranslatedUnit[] = [];
    const fetchImpl = this.options.fetch ?? fetch;

    for (const batch of batches) {
      const response = await fetchWithRetry(
        fetchImpl,
        `${trimTrailingSlash(this.options.endpoint ?? "https://api-free.deepl.com")}/v2/translate`,
        {
          method: "POST",
          headers: {
            authorization: `DeepL-Auth-Key ${this.options.apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            text: batch.units.map((unit) => unit.sourceText),
            target_lang: normalizeDeepLLanguage(request.targetLanguage),
            ...(request.sourceLanguage === "auto"
              ? {}
              : { source_lang: normalizeDeepLLanguage(request.sourceLanguage) })
          })
        }
      );

      if (!response.ok) {
        throw new Error(`DeepL API error ${response.status}: ${await readErrorBody(response)}`);
      }

      const payload = (await response.json()) as { translations?: Array<{ text?: unknown }> };
      const texts = payload.translations?.map((item) => item.text);
      if (!texts || texts.some((text) => typeof text !== "string")) {
        throw new Error("DeepL API response did not contain valid translations.");
      }
      translations.push(...createTranslatedUnits(batch.units, texts as string[]));
    }

    return {
      translations,
      warnings: [],
      requestCount: batches.length
    };
  }
}

function normalizeDeepLLanguage(language: string): string {
  return language.replace("-", "_").toUpperCase();
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
