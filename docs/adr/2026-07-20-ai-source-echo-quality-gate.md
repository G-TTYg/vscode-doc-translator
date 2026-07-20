# ADR 2026-07-20: AI Source-Echo Quality Gate

Status: Accepted
Date: 2026-07-20

## Context

An OpenAI Responses translation returned every requested id but copied the English source text into the translation fields. Because the response was structurally complete, the old pipeline recorded 205 translated segments, zero warnings, and a complete cache entry. A model could produce the same failure through `skip=true`, because skipped items were reconstructed from source text.

Structural JSON validation is therefore necessary but insufficient. The shared AI pipeline needs a provider-independent content check before any translated artifact is written.

## Decision

1. AI prompts explicitly name the target language and restrict `skip=true` to non-language content or content already in the target language.
2. The shared harness compares meaningful natural-language source and output units after normalizing case, whitespace, and punctuation.
3. When at least 50% of considered units in a chunk remain unchanged, the harness retries only those ids once with an `unchanged-repair` instruction.
4. If at least 50% remain unchanged after repair, translation fails before reconstruction or file writing.
5. Explicit same-language requests and source text predominantly written in a recognized target script are excluded from the source-echo ratio.
6. AI cache identity includes provider id, sanitized endpoint, model, token budgets, and harness version. The translation profile also includes core and format-adapter versions.

## Consequences

- A structurally valid mass source echo can no longer become a complete translated artifact or reusable cache entry.
- One focused retry adds cost only after a high-confidence quality failure.
- Small amounts of intentionally unchanged terminology remain allowed.
- The check does not claim semantic translation correctness; it specifically prevents unchanged-source false success.
- Existing cache entries miss the new profile hash and are regenerated under the stronger harness.

## References

- `src/core/providers/aiTranslationHarness.ts`
- `src/core/providers/structuredLlmProvider.ts`
- `src/core/application/translateDocument.ts`
- `tests/aiTranslationHarness.test.ts`
