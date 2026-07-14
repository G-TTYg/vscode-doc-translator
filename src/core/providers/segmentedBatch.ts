import type { TranslateRequest, TranslatedUnit, TranslationUnit } from "../domain/types";

export interface UnitBatch {
  readonly units: readonly TranslationUnit[];
  readonly characterCount: number;
}

export function chunkTranslationUnits(
  units: readonly TranslationUnit[],
  maxBatchCharacters: number
): readonly UnitBatch[] {
  const safeMax = Math.max(1000, maxBatchCharacters);
  const batches: UnitBatch[] = [];
  let currentUnits: TranslationUnit[] = [];
  let currentCount = 0;

  for (const unit of units) {
    const unitLength = unit.sourceText.length;
    if (currentUnits.length > 0 && currentCount + unitLength > safeMax) {
      batches.push({ units: currentUnits, characterCount: currentCount });
      currentUnits = [];
      currentCount = 0;
    }

    currentUnits.push(unit);
    currentCount += unitLength;
  }

  if (currentUnits.length > 0) {
    batches.push({ units: currentUnits, characterCount: currentCount });
  }

  return batches;
}

export function createTranslatedUnits(
  units: readonly TranslationUnit[],
  translatedTexts: readonly string[]
): readonly TranslatedUnit[] {
  if (translatedTexts.length !== units.length) {
    throw new Error(
      `Provider returned ${translatedTexts.length} translation(s) for ${units.length} unit(s).`
    );
  }

  return units.map((unit, index) => ({
    id: unit.id,
    text: translatedTexts[index]
  }));
}

export function assertSegmentedRequest(request: TranslateRequest, providerId: string): void {
  if (request.orderedContext) {
    throw new Error(`${providerId} provider expects segmented units, not ordered JSON context.`);
  }
}
