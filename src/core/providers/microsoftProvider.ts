import type {
  TranslateRequest,
  TranslateResult,
  TranslationProvider,
  TranslatedUnit
} from "../domain/types";
import { fetchWithRetry, readErrorBody } from "./http";
import { assertSegmentedRequest, chunkTranslationUnits, createTranslatedUnits } from "./segmentedBatch";

export interface MicrosoftTranslatorProviderOptions {
  readonly apiKey: string;
  readonly region?: string;
  readonly endpoint?: string;
  readonly maxBatchCharacters?: number;
  readonly fetch?: typeof fetch;
}

const DEFAULT_MAX_BATCH_CHARACTERS = 45000;

export class MicrosoftTranslatorProvider implements TranslationProvider {
  readonly id = "microsoft";
  readonly displayName = "Microsoft Translator";
  readonly capabilities;

  constructor(private readonly options: MicrosoftTranslatorProviderOptions) {
    if (!options.apiKey) {
      throw new Error("Microsoft Translator API key is required.");
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
        `${trimTrailingSlash(this.options.endpoint ?? "https://api.cognitive.microsofttranslator.com")}/translate`
      );
      url.searchParams.set("api-version", "3.0");
      url.searchParams.append("to", normalizeMicrosoftLanguage(request.targetLanguage));
      if (request.sourceLanguage !== "auto") {
        url.searchParams.set("from", normalizeMicrosoftLanguage(request.sourceLanguage));
      }

      const headers: Record<string, string> = {
        "ocp-apim-subscription-key": this.options.apiKey,
        "content-type": "application/json"
      };
      if (this.options.region) {
        headers["ocp-apim-subscription-region"] = this.options.region;
      }

      const response = await fetchWithRetry(fetchImpl, url, {
        method: "POST",
        headers,
        body: JSON.stringify(batch.units.map((unit) => ({ Text: unit.sourceText })))
      });

      if (!response.ok) {
        throw new Error(
          `Microsoft Translator API error ${response.status}: ${await readErrorBody(response)}`
        );
      }

      const payload = (await response.json()) as Array<{
        translations?: Array<{ text?: unknown }>;
      }>;
      const texts = payload.map((item) => item.translations?.[0]?.text);
      if (texts.some((text) => typeof text !== "string")) {
        throw new Error("Microsoft Translator API response did not contain valid translations.");
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

function normalizeMicrosoftLanguage(language: string): string {
  const normalized = language.trim().toLowerCase().replace(/_/g, "-");
  const languageMap: Record<string, string> = {
    "en-gb": "en",
    "en-us": "en",
    "pt-br": "pt",
    "pt-pt": "pt-pt",
    "zh-cn": "zh-Hans",
    "zh-hans": "zh-Hans",
    "zh-tw": "zh-Hant",
    "zh-hant": "zh-Hant"
  };

  return languageMap[normalized] ?? normalized;
}
