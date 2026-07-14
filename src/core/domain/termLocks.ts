import type { ProtectedToken, TranslationUnit } from "./types";

export interface TermLockedUnits {
  readonly units: readonly TranslationUnit[];
  readonly tokensByUnitId: ReadonlyMap<string, readonly ProtectedToken[]>;
}

export function applyTermLocks(
  units: readonly TranslationUnit[],
  terms: readonly string[]
): TermLockedUnits {
  const normalizedTerms = [...new Set(terms.map((term) => term.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  const tokensByUnitId = new Map<string, readonly ProtectedToken[]>();

  if (normalizedTerms.length === 0) {
    return { units, tokensByUnitId };
  }

  const lockedUnits = units.map((unit) => {
    let sourceText = unit.sourceText;
    const tokens: ProtectedToken[] = [];

    normalizedTerms.forEach((term, index) => {
      const escaped = escapeRegExp(term);
      const pattern = new RegExp(escaped, "g");
      sourceText = sourceText.replace(pattern, () => {
        const token = `__VDT_TERM_${unit.order}_${index}_${tokens.length}__`;
        tokens.push({ token, value: term });
        return token;
      });
    });

    if (tokens.length === 0) {
      return unit;
    }

    tokensByUnitId.set(unit.id, tokens);
    return {
      ...unit,
      sourceText,
      protectedTokens: [...unit.protectedTokens, ...tokens]
    };
  });

  return {
    units: lockedUnits,
    tokensByUnitId
  };
}

export function restoreTermLocks(text: string, tokens: readonly ProtectedToken[] = []): string {
  return tokens.reduce((current, token) => current.split(token.token).join(token.value), text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
