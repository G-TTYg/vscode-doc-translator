export interface TargetLanguageOption {
  readonly code: string;
  readonly label: string;
}

const TARGET_LANGUAGE_DATA: readonly TargetLanguageOption[] = [
  { code: "ar", label: "Arabic" },
  { code: "bg", label: "Bulgarian" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "nl", label: "Dutch" },
  { code: "en-US", label: "English (American)" },
  { code: "en-GB", label: "English (British)" },
  { code: "et", label: "Estonian" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "hu", label: "Hungarian" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "lv", label: "Latvian" },
  { code: "lt", label: "Lithuanian" },
  { code: "nb", label: "Norwegian Bokmal" },
  { code: "pl", label: "Polish" },
  { code: "pt-BR", label: "Portuguese (Brazilian)" },
  { code: "pt-PT", label: "Portuguese (European)" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "sk", label: "Slovak" },
  { code: "sl", label: "Slovenian" },
  { code: "es", label: "Spanish" },
  { code: "sv", label: "Swedish" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" }
];

export const TARGET_LANGUAGES: readonly TargetLanguageOption[] = [...TARGET_LANGUAGE_DATA].sort(
  (left, right) =>
    left.label.localeCompare(right.label, "en", { sensitivity: "base" }) ||
    left.code.localeCompare(right.code, "en", { sensitivity: "base" })
);

const CODE_BY_LOWERCASE = new Map(
  TARGET_LANGUAGES.map((language) => [language.code.toLowerCase(), language.code])
);

const LANGUAGE_ALIASES = new Map<string, string>([
  ["en", "en-US"],
  ["en_us", "en-US"],
  ["en-gb", "en-GB"],
  ["en_uk", "en-GB"],
  ["en-uk", "en-GB"],
  ["pt", "pt-BR"],
  ["pt_br", "pt-BR"],
  ["pt_pt", "pt-PT"],
  ["zh", "zh-CN"],
  ["zh_cn", "zh-CN"],
  ["zh-hans", "zh-CN"],
  ["zh_hans", "zh-CN"],
  ["zh_tw", "zh-TW"],
  ["zh-hant", "zh-TW"],
  ["zh_hant", "zh-TW"],
  ["no", "nb"]
]);

export function normalizeTargetLanguageCode(
  value: string | undefined,
  fallback = "zh-CN"
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  const lower = trimmed.toLowerCase();
  return CODE_BY_LOWERCASE.get(lower) ?? LANGUAGE_ALIASES.get(lower) ?? fallback;
}
