import type {
  OrderedContextUnit,
  TranslatedUnit,
  TranslationProvider
} from "../domain/types";

export const AI_TRANSLATION_HARNESS_VERSION = "3";

export type LlmTranslationAttempt =
  | "initial"
  | "missing-repair"
  | "unchanged-repair"
  | "protected-token-repair";

export interface UnchangedTranslationReport {
  readonly consideredUnitIds: readonly string[];
  readonly unchangedUnitIds: readonly string[];
  readonly unchangedRatio: number;
}

export interface ProtectedTokenReport {
  readonly affectedUnitIds: readonly string[];
  readonly violationCount: number;
}

const REPAIR_THRESHOLD = 0.5;
const REJECT_THRESHOLD = 0.5;

export function createTranslationSystemPrompt(
  targetLanguage: string,
  attempt: LlmTranslationAttempt
): string {
  const repairInstruction =
    attempt === "unchanged-repair"
      ? " QUALITY REPAIR: the previous response echoed source text for the requested ids. " +
        "Translate those units now; do not repeat the source wording."
      : attempt === "protected-token-repair"
        ? " TOKEN REPAIR: the previous response changed, removed, or duplicated protected token strings. " +
          "Return a translated text for every requested id and copy every requiredProtectedTokens entry " +
          "exactly once. Never replace a token with its underlying code, URL, markup, or term; never escape " +
          "or wrap a token with Markdown punctuation."
      : attempt === "missing-repair"
        ? " COMPLETENESS REPAIR: return every requested id that was previously omitted."
        : "";

  return (
    `You are a document translation engine. Translate natural-language content into ${targetLanguage}. ` +
    "Auto-detect the source language when sourceLanguage is auto. Translate prose, headings, list items, " +
    "table cells, labels, and technical explanations while preserving meaning and tone. " +
    "Use referenceDocument only for context and translate only ids listed in translationUnitIds. " +
    "Return exactly one translations item for every requested id. Preserve protected token strings exactly. " +
    "Each item must contain id, text, and skip. Set skip to false and text to the target-language translation. " +
    "For each unit, copy every requiredProtectedTokens string into text exactly once without escaping, " +
    "wrapping, translating, replacing, or reformatting it. " +
    "Use skip=true only when a unit has no translatable natural-language content or is already written in the " +
    "target language; technical subject matter, identifiers inside prose, and unfamiliar terminology are not " +
    "reasons to skip a unit. Return only the requested JSON object and never render a final document." +
    repairInstruction
  );
}

export function inspectProtectedTokens(input: {
  readonly expectedUnitIds: readonly string[];
  readonly contextUnits: readonly OrderedContextUnit[];
  readonly translations: readonly TranslatedUnit[];
}): ProtectedTokenReport {
  const contextById = new Map(input.contextUnits.map((unit) => [unit.id, unit]));
  const translatedById = new Map(input.translations.map((translation) => [translation.id, translation]));
  const affectedUnitIds: string[] = [];
  let violationCount = 0;

  for (const id of input.expectedUnitIds) {
    const unit = contextById.get(id);
    const translation = translatedById.get(id);
    if (!unit || !translation || unit.protectedTokens.length === 0) {
      continue;
    }
    const violations = unit.protectedTokens.filter(
      ({ token }) => countOccurrences(translation.text, token) !== 1
    ).length;
    if (violations > 0) {
      affectedUnitIds.push(id);
      violationCount += violations;
    }
  }

  return { affectedUnitIds, violationCount };
}

export function normalizeProtectedTokenFormatting(input: {
  readonly contextUnits: readonly OrderedContextUnit[];
  readonly translations: readonly TranslatedUnit[];
}): readonly TranslatedUnit[] {
  const contextById = new Map(input.contextUnits.map((unit) => [unit.id, unit]));
  return input.translations.map((translation) => {
    const tokens = contextById.get(translation.id)?.protectedTokens ?? [];
    const normalized = tokens.reduce(
      (text, protectedToken) => normalizeTokenAliases(text, protectedToken),
      translation.text
    );
    return normalized === translation.text ? translation : { ...translation, text: normalized };
  });
}

export function protectedTokenWarning(
  report: ProtectedTokenReport,
  providerName: string,
  action: "retrying" | "remaining"
): string {
  const summary =
    `${report.violationCount} protected token violation(s) in ` +
    `${report.affectedUnitIds.length} unit(s): ${summarizeIds(report.affectedUnitIds)}`;
  return action === "retrying"
    ? `${providerName} found ${summary}; retrying affected units`
    : `${providerName} still has ${summary}`;
}

export function inspectUnchangedTranslations(input: {
  readonly sourceLanguage: string | "auto";
  readonly targetLanguage: string;
  readonly expectedUnitIds: readonly string[];
  readonly contextUnits: readonly OrderedContextUnit[];
  readonly translations: readonly TranslatedUnit[];
}): UnchangedTranslationReport {
  if (sameLanguage(input.sourceLanguage, input.targetLanguage)) {
    return emptyReport();
  }

  const sourceById = new Map(input.contextUnits.map((unit) => [unit.id, unit.sourceText]));
  const translatedById = new Map(input.translations.map((translation) => [translation.id, translation]));
  const consideredUnitIds: string[] = [];
  const unchangedUnitIds: string[] = [];

  for (const id of input.expectedUnitIds) {
    const sourceText = sourceById.get(id);
    const translation = translatedById.get(id);
    if (
      sourceText === undefined ||
      !translation ||
      translation.preservedSource ||
      !hasMeaningfulNaturalLanguage(sourceText) ||
      looksLikeTargetLanguage(sourceText, input.targetLanguage)
    ) {
      continue;
    }

    consideredUnitIds.push(id);
    if (normalizeComparableText(sourceText) === normalizeComparableText(translation.text)) {
      unchangedUnitIds.push(id);
    }
  }

  return {
    consideredUnitIds,
    unchangedUnitIds,
    unchangedRatio:
      consideredUnitIds.length === 0 ? 0 : unchangedUnitIds.length / consideredUnitIds.length
  };
}

export function shouldRepairUnchangedTranslations(report: UnchangedTranslationReport): boolean {
  return report.unchangedUnitIds.length > 0 && report.unchangedRatio >= REPAIR_THRESHOLD;
}

export function assertAcceptableUnchangedRatio(
  report: UnchangedTranslationReport,
  providerName: string
): void {
  if (report.unchangedUnitIds.length > 0 && report.unchangedRatio >= REJECT_THRESHOLD) {
    throw new Error(
      `${providerName} translation quality check failed: ${report.unchangedUnitIds.length} of ` +
        `${report.consideredUnitIds.length} natural-language unit(s) remained identical to the source ` +
        "after a focused retry. No translated file was written."
    );
  }
}

export function unchangedTranslationWarning(
  report: UnchangedTranslationReport,
  providerName: string,
  action: "retrying" | "remaining"
): string {
  const ids = summarizeIds(report.unchangedUnitIds);
  return action === "retrying"
    ? `${providerName} echoed source text for ${report.unchangedUnitIds.length} natural-language unit(s), retrying: ${ids}`
    : `${providerName} left ${report.unchangedUnitIds.length} natural-language unit(s) unchanged: ${ids}`;
}

export function replaceTranslations(
  current: readonly TranslatedUnit[],
  replacements: readonly TranslatedUnit[],
  expectedIds: readonly string[]
): readonly TranslatedUnit[] {
  const expected = new Set(expectedIds);
  const byId = new Map(current.filter((item) => expected.has(item.id)).map((item) => [item.id, item]));
  for (const replacement of replacements) {
    if (expected.has(replacement.id)) {
      byId.set(replacement.id, replacement);
    }
  }
  return expectedIds.flatMap((id) => {
    const translation = byId.get(id);
    return translation ? [translation] : [];
  });
}

export function createLlmProviderCacheIdentity(input: {
  readonly providerId: string;
  readonly endpoint: string;
  readonly model: string;
  readonly capabilities: TranslationProvider["capabilities"];
}): string {
  return JSON.stringify({
    providerId: input.providerId,
    endpoint: safeEndpointLabel(input.endpoint),
    model: input.model,
    maxContextCharacters: input.capabilities.maxContextCharacters,
    maxContextTokens: input.capabilities.maxContextTokens,
    maxOutputTokens: input.capabilities.maxOutputTokens,
    harnessVersion: AI_TRANSLATION_HARNESS_VERSION
  });
}

export function safeEndpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return endpoint.replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function hasMeaningfulNaturalLanguage(text: string): boolean {
  const visibleText = text.replace(/__VDT_(?:PROTECTED|TERM)_[A-Za-z0-9_]+__/g, " ");
  const letters = visibleText.match(/\p{L}/gu)?.length ?? 0;
  const words = visibleText.match(/[\p{L}\p{M}]+/gu)?.length ?? 0;
  return letters >= 12 || (letters >= 8 && words >= 2);
}

function normalizeTokenAliases(
  text: string,
  protectedToken: OrderedContextUnit["protectedTokens"][number]
): string {
  const { token, value } = protectedToken;
  const inner = token.startsWith("__") && token.endsWith("__") ? token.slice(2, -2) : token;
  const aliases = [
    token.replace(/_/g, "\\_"),
    `**${inner}**`,
    `**${inner.replace(/_/g, "\\_")}**`,
    `\`${token}\``
  ];
  const normalized = aliases.reduce((current, alias) => current.split(alias).join(token), text);
  if (normalized.includes(token) || !value) {
    return normalized;
  }
  const valueIndex = normalized.indexOf(value);
  return valueIndex < 0
    ? normalized
    : `${normalized.slice(0, valueIndex)}${token}${normalized.slice(valueIndex + value.length)}`;
}

function countOccurrences(text: string, value: string): number {
  if (!value) {
    return 0;
  }
  return text.split(value).length - 1;
}

function looksLikeTargetLanguage(text: string, targetLanguage: string): boolean {
  const base = normalizeLanguage(targetLanguage).split("-")[0];
  const pattern = targetScriptPattern(base);
  if (!pattern) {
    return false;
  }
  const targetScriptLetters = text.match(pattern)?.length ?? 0;
  const allLetters = text.match(/\p{L}/gu)?.length ?? 0;
  return targetScriptLetters >= 2 && targetScriptLetters / Math.max(1, allLetters) >= 0.5;
}

function targetScriptPattern(language: string): RegExp | undefined {
  switch (language) {
    case "zh":
      return /\p{Script=Han}/gu;
    case "ja":
      return /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
    case "ko":
      return /\p{Script=Hangul}/gu;
    case "ru":
    case "uk":
    case "bg":
      return /\p{Script=Cyrillic}/gu;
    case "el":
      return /\p{Script=Greek}/gu;
    case "ar":
      return /\p{Script=Arabic}/gu;
    default:
      return undefined;
  }
}

function sameLanguage(sourceLanguage: string | "auto", targetLanguage: string): boolean {
  if (sourceLanguage === "auto") {
    return false;
  }
  const source = normalizeLanguage(sourceLanguage);
  const target = normalizeLanguage(targetLanguage);
  return source === target || source.split("-")[0] === target.split("-")[0];
}

function normalizeLanguage(language: string): string {
  return language.trim().replace(/_/g, "-").toLowerCase();
}

function normalizeComparableText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeIds(ids: readonly string[]): string {
  const displayed = ids.slice(0, 8).join(", ");
  return ids.length > 8 ? `${displayed}, ...` : displayed;
}

function emptyReport(): UnchangedTranslationReport {
  return { consideredUnitIds: [], unchangedUnitIds: [], unchangedRatio: 0 };
}
