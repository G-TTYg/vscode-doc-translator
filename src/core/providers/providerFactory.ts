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
        apiKey: options.deepl?.apiKey ?? "",
        endpoint: options.deepl?.endpoint,
        maxBatchCharacters: options.deepl?.maxBatchCharacters
      });
    case "google":
      return new GoogleTranslateProvider({
        apiKey: options.google?.apiKey ?? "",
        endpoint: options.google?.endpoint,
        maxBatchCharacters: options.google?.maxBatchCharacters
      });
    case "microsoft":
      return new MicrosoftTranslatorProvider({
        apiKey: options.microsoft?.apiKey ?? "",
        region: options.microsoft?.region,
        endpoint: options.microsoft?.endpoint,
        maxBatchCharacters: options.microsoft?.maxBatchCharacters
      });
    case "openai-compatible":
      return new OpenAiCompatibleProvider({
        endpoint: options.openAiCompatible?.endpoint ?? "https://api.openai.com/v1",
        apiKey: options.openAiCompatible?.apiKey ?? "",
        model: options.openAiCompatible?.model ?? "",
        maxContextTokens: options.openAiCompatible?.maxContextTokens,
        maxOutputTokens: options.openAiCompatible?.maxOutputTokens,
        maxContextCharacters: options.openAiCompatible?.maxContextCharacters
      });
    default:
      throw new Error(`Unsupported provider: ${options.providerId}`);
  }
}
