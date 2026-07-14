import type { TranslateResult, TranslationUnit } from "../domain/types";

export function validateTranslatedUnits(
  units: readonly TranslationUnit[],
  result: TranslateResult
): readonly string[] {
  const warnings: string[] = [...result.warnings];
  const expectedIds = new Set(units.map((unit) => unit.id));
  const seen = new Set<string>();

  for (const translation of result.translations) {
    if (!expectedIds.has(translation.id)) {
      warnings.push(`Provider returned unknown translation id: ${translation.id}`);
    }
    if (seen.has(translation.id)) {
      warnings.push(`Provider returned duplicate translation id: ${translation.id}`);
    }
    seen.add(translation.id);
  }

  for (const expectedId of expectedIds) {
    if (!seen.has(expectedId)) {
      warnings.push(`Provider did not return translation id: ${expectedId}`);
    }
  }

  return warnings;
}
