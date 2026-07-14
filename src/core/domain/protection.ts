import type { ProtectedToken } from "./types";

export interface ProtectedText {
  readonly text: string;
  readonly tokens: readonly ProtectedToken[];
}

type MatchRange = {
  start: number;
  end: number;
};

export function protectMarkdownInlineText(text: string): ProtectedText {
  const ranges: MatchRange[] = [];
  collectMatches(text, /`[^`\r\n]+`/g, ranges);
  collectMatches(text, /!\[[^\]\r\n]*\]\([^)]+\)/g, ranges);
  collectMatches(text, /https?:\/\/[^\s)]+/g, ranges);
  collectMatches(text, /<\/?[A-Za-z][^>]*>/g, ranges);
  collectLinkTargets(text, ranges);

  const merged = mergeRanges(ranges);
  if (merged.length === 0) {
    return { text, tokens: [] };
  }

  let protectedText = "";
  const tokens: ProtectedToken[] = [];
  let cursor = 0;

  for (const range of merged) {
    protectedText += text.slice(cursor, range.start);
    const value = text.slice(range.start, range.end);
    const token = `__VDT_PROTECTED_${tokens.length}__`;
    protectedText += token;
    tokens.push({ token, value });
    cursor = range.end;
  }

  protectedText += text.slice(cursor);
  return { text: protectedText, tokens };
}

export function restoreProtectedTokens(text: string, tokens: readonly ProtectedToken[]): string {
  return tokens.reduce((current, protectedToken) => {
    return current.split(protectedToken.token).join(protectedToken.value);
  }, text);
}

export function findMissingProtectedTokens(
  translatedText: string,
  tokens: readonly ProtectedToken[]
): readonly ProtectedToken[] {
  return tokens.filter((protectedToken) => !translatedText.includes(protectedToken.token));
}

function collectMatches(text: string, pattern: RegExp, ranges: MatchRange[]): void {
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
}

function collectLinkTargets(text: string, ranges: MatchRange[]): void {
  const pattern = /\[[^\]\r\n]+\]\(([^)\r\n]+)\)/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined || match[1] === undefined) {
      continue;
    }
    const targetStart = match.index + match[0].lastIndexOf(match[1]);
    ranges.push({ start: targetStart, end: targetStart + match[1].length });
  }
}

function mergeRanges(ranges: readonly MatchRange[]): readonly MatchRange[] {
  const sorted = [...ranges]
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: MatchRange[] = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }

  return merged;
}
