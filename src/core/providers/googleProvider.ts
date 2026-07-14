import type {
  TranslateRequest,
  TranslateResult,
  TranslationProvider,
  TranslatedUnit
} from "../domain/types";
import { fetchWithRetry, readErrorBody } from "./http";
import { assertSegmentedRequest, chunkTranslationUnits, createTranslatedUnits } from "./segmentedBatch";

export interface GoogleTranslateProviderOptions {
  readonly apiKey: string;
  readonly endpoint?: string;
  readonly maxBatchCharacters?: number;
  readonly fetch?: typeof fetch;
}

const DEFAULT_MAX_BATCH_CHARACTERS = 25000;

export class GoogleTranslateProvider implements TranslationProvider {
  readonly id = "google";
  readonly displayName = "Google Cloud Translation";
  readonly capabilities;

  constructor(private readonly options: GoogleTranslateProviderOptions) {
    if (!options.apiKey) {
      throw new Error("Google Cloud Translation API key is required.");
    }
    this.capabilities = {
      requestPackaging: "segmented-units" as const,
      maxBatchCharacters: options.maxBatchCharacters ?? DEFAULT_MAX_BATCH_CHARACTERS,
      supportsStructuredJsonOutput: false,
      supportsGlossary: false
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
      const url = new URL(
        `${trimTrailingSlash(this.options.endpoint ?? "https://translation.googleapis.com")}/language/translate/v2`
      );
      url.searchParams.set("key", this.options.apiKey);

      const response = await fetchWithRetry(fetchImpl, url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          q: batch.units.map((unit) => unit.sourceText),
          target: normalizeGoogleLanguage(request.targetLanguage),
          format: "text",
          ...(request.sourceLanguage === "auto"
            ? {}
            : { source: normalizeGoogleLanguage(request.sourceLanguage) })
        })
      });

      if (!response.ok) {
        throw new Error(
          `Google Cloud Translation API error ${response.status}: ${await readErrorBody(response)}`
        );
      }

      const payload = (await response.json()) as {
        data?: { translations?: Array<{ translatedText?: unknown }> };
      };
      const texts = payload.data?.translations?.map((item) => item.translatedText);
      if (!texts || texts.some((text) => typeof text !== "string")) {
        throw new Error("Google Cloud Translation API response did not contain valid translations.");
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeGoogleLanguage(language: string): string {
  const normalized = language.trim().toLowerCase().replace(/_/g, "-");
  const languageMap: Record<string, string> = {
    "en-gb": "en",
    "en-us": "en",
    nb: "no",
    "pt-br": "pt",
    "pt-pt": "pt",
    "zh-cn": "zh-CN",
    "zh-hans": "zh-CN",
    "zh-tw": "zh-TW",
    "zh-hant": "zh-TW"
  };

  return languageMap[normalized] ?? normalized;
}
