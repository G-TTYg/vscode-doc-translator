import type { TranslateRequest, TranslateResult, TranslationProvider } from "../domain/types";

export class FakeTranslationProvider implements TranslationProvider {
  readonly id = "fake";
  readonly displayName = "Fake local provider";
  readonly capabilities = {
    requestPackaging: "segmented-units" as const,
    supportsStructuredJsonOutput: true
  };

  async translateBatch(request: TranslateRequest): Promise<TranslateResult> {
    const sourceUnits = request.orderedContext?.units ?? request.units;
    return {
      translations: sourceUnits.map((unit) => ({
        id: unit.id,
        text: `[${request.targetLanguage}] ${unit.sourceText}`
      })),
      warnings: [],
      requestCount: 1
    };
  }
}
