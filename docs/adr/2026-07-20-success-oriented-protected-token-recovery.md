# ADR 2026-07-20: Success-Oriented Protected Token Recovery

Status: Accepted
Date: 2026-07-20

## Context

AI models may preserve protected placeholders exactly, escape their underscores as Markdown, replace them with the original code or URL, or omit them. Treating every variation as a fatal format error caused otherwise useful translations to fail with dozens of repeated validation messages.

Protected content exists to make translation safer. It must not turn recoverable model behavior into an all-or-nothing document failure.

## Decision

1. Markdown protected tokens include the unit order so every placeholder is unique within a document.
2. AI payloads provide both required token strings and their original protected content as context.
3. The harness normalizes exact tokens, Markdown-escaped/bold forms, and unchanged original values back to canonical tokens locally.
4. Missing or duplicated tokens trigger one focused retry containing only affected unit ids.
5. If retry still fails, affected units use their protected source text while all other units remain translated. The document is written successfully with warnings in metadata and the VS Code completion message.
6. Mass source echo remains a blocking failure because a document that is mostly unchanged is not a translation.

## Consequences

- Common model formatting differences no longer fail translation.
- Protected code, links, markup, and locked terms remain structurally safe.
- A difficult unit may remain untranslated, but it does not discard successful translations for the rest of the document.
- Users receive a warning when local source fallback was required.

## References

- `src/core/domain/protection.ts`
- `src/core/providers/aiTranslationHarness.ts`
- `src/core/providers/structuredLlmProvider.ts`
- `tests/aiTranslationHarness.test.ts`
