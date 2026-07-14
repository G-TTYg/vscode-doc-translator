import { DeepLProvider, type DeepLProviderOptions } from "./deeplProvider";
import { GoogleTranslateProvider, type GoogleTranslateProviderOptions } from "./googleProvider";
import {
  MicrosoftTranslatorProvider,
  type MicrosoftTranslatorProviderOptions
} from "./microsoftProvider";
import {
  OpenAiCompatibleProvider,
  type OpenAiCompatibleProviderOptions
} from "./openAiCompatibleProvider";
import type { TranslationProvider } from "../domain/types";

export interface ProviderFactoryOptions {
  readonly providerId: string;
  readonly openAiCompatible?: Partial<OpenAiCompatibleProviderOptions>;
  readonly deepl?: Partial<DeepLProviderOptions>;
  readonly google?: Partial<GoogleTranslateProviderOptions>;
  readonly microsoft?: Partial<MicrosoftTranslatorProviderOptions>;
}

export function createProvider(options: ProviderFactoryOptions): TranslationProvider {
  switch (options.providerId) {
    case "deepl":
      return new DeepLProvider({
        apiKey: options.deepl?.apiKey ?? process.env.DOC_TRANSLATOR_DEEPL_API_KEY ?? "",
        endpoint: options.deepl?.endpoint ?? process.env.DOC_TRANSLATOR_DEEPL_ENDPOINT,
        maxBatchCharacters: options.deepl?.maxBatchCharacters
      });
    case "google":
      return new GoogleTranslateProvider({
        apiKey: options.google?.apiKey ?? process.env.DOC_TRANSLATOR_GOOGLE_API_KEY ?? "",
        endpoint: options.google?.endpoint ?? process.env.DOC_TRANSLATOR_GOOGLE_ENDPOINT,
        maxBatchCharacters: options.google?.maxBatchCharacters
      });
    case "microsoft":
      return new MicrosoftTranslatorProvider({
        apiKey:
          options.microsoft?.apiKey ?? process.env.DOC_TRANSLATOR_MICROSOFT_API_KEY ?? "",
        region: options.microsoft?.region ?? process.env.DOC_TRANSLATOR_MICROSOFT_REGION,
        endpoint:
          options.microsoft?.endpoint ?? process.env.DOC_TRANSLATOR_MICROSOFT_ENDPOINT,
        maxBatchCharacters: options.microsoft?.maxBatchCharacters
      });
    case "openai-compatible":
      return new OpenAiCompatibleProvider({
        endpoint:
          options.openAiCompatible?.endpoint ??
          process.env.DOC_TRANSLATOR_OPENAI_ENDPOINT ??
          "https://api.openai.com/v1",
        apiKey: options.openAiCompatible?.apiKey ?? process.env.DOC_TRANSLATOR_OPENAI_API_KEY ?? "",
        model: options.openAiCompatible?.model ?? process.env.DOC_TRANSLATOR_OPENAI_MODEL ?? "",
        maxContextTokens:
          options.openAiCompatible?.maxContextTokens ??
          parseOptionalInt(process.env.DOC_TRANSLATOR_OPENAI_MAX_CONTEXT_TOKENS),
        maxOutputTokens:
          options.openAiCompatible?.maxOutputTokens ??
          parseOptionalInt(process.env.DOC_TRANSLATOR_OPENAI_MAX_OUTPUT_TOKENS),
        maxContextCharacters:
          options.openAiCompatible?.maxContextCharacters ??
          parseOptionalInt(process.env.DOC_TRANSLATOR_OPENAI_MAX_CONTEXT_CHARS)
      });
    default:
      throw new Error(`Unsupported provider: ${options.providerId}`);
  }
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
