import type {
  TranslateRequest,
  TranslateResult,
  TranslationProvider
} from "../src/core/domain/types";

export class PrefixTranslationProvider implements TranslationProvider {
  readonly id = "test-prefix";
  readonly displayName = "Test prefix provider";
  readonly capabilities = {
    requestPackaging: "segmented-units" as const,
    supportsStructuredJsonOutput: true
  };

  async translateBatch(request: TranslateRequest): Promise<TranslateResult> {
    return {
      translations: request.units.map((unit) => ({
        id: unit.id,
        text: `[${request.targetLanguage}] ${unit.sourceText}`
      })),
      warnings: [],
      requestCount: 1
    };
  }
}
