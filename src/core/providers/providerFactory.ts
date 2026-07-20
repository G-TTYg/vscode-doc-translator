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
import {
  OpenAiResponsesProvider,
  type OpenAiResponsesProviderOptions
} from "./openAiResponsesProvider";
import { AnthropicProvider, type AnthropicProviderOptions } from "./anthropicProvider";
import { GeminiProvider, type GeminiProviderOptions } from "./geminiProvider";
import type { TranslationProvider } from "../domain/types";

export interface ProviderFactoryOptions {
  readonly providerId: string;
  readonly openAiResponses?: Partial<OpenAiResponsesProviderOptions>;
  readonly openAiCompatible?: Partial<OpenAiCompatibleProviderOptions>;
  readonly anthropic?: Partial<AnthropicProviderOptions>;
  readonly gemini?: Partial<GeminiProviderOptions>;
  readonly deepl?: Partial<DeepLProviderOptions>;
  readonly google?: Partial<GoogleTranslateProviderOptions>;
  readonly microsoft?: Partial<MicrosoftTranslatorProviderOptions>;
}

export function createProvider(options: ProviderFactoryOptions): TranslationProvider {
  switch (options.providerId) {
    case "openai-responses":
      return new OpenAiResponsesProvider({
        endpoint: options.openAiResponses?.endpoint ?? "https://api.openai.com/v1",
        apiKey: options.openAiResponses?.apiKey ?? "",
        model: options.openAiResponses?.model ?? "",
        maxContextTokens: options.openAiResponses?.maxContextTokens,
        maxOutputTokens: options.openAiResponses?.maxOutputTokens,
        maxContextCharacters: options.openAiResponses?.maxContextCharacters
      });
    case "anthropic":
      return new AnthropicProvider({
        endpoint: options.anthropic?.endpoint ?? "https://api.anthropic.com",
        apiKey: options.anthropic?.apiKey ?? "",
        model: options.anthropic?.model ?? "",
        maxContextTokens: options.anthropic?.maxContextTokens,
        maxOutputTokens: options.anthropic?.maxOutputTokens,
        maxContextCharacters: options.anthropic?.maxContextCharacters
      });
    case "gemini":
      return new GeminiProvider({
        endpoint:
          options.gemini?.endpoint ?? "https://generativelanguage.googleapis.com/v1beta",
        apiKey: options.gemini?.apiKey ?? "",
        model: options.gemini?.model ?? "",
        maxContextTokens: options.gemini?.maxContextTokens,
        maxOutputTokens: options.gemini?.maxOutputTokens,
        maxContextCharacters: options.gemini?.maxContextCharacters
      });
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
