# ADR 2026-07-20: Success-Oriented AI Translation Recovery

Status: Accepted
Date: 2026-07-20

## Context

Strict whole-document rejection prevented useful translations when an AI provider returned an alternate JSON shape, omitted some ids, echoed a small number of technical labels, or damaged protected placeholders. Real corpus testing also showed that sending an already-Chinese document to a Chinese target wasted output budget and created avoidable protocol failures.

## Decision

1. Keep repairs bounded: retry an invalid response shape once, missing ids once, source echoes once, and protected-token violations once.
2. Accept the required translation array, flat requested-id mappings, and a single requested `{ id, text, skip }` object.
3. After bounded repair, preserve source text only for unresolved units and continue reconstruction with warnings.
4. Isolate protected-token repair context to affected units and reject duplicated or cross-unit leaked placeholders.
5. When source-language detection is automatic and the document predominantly uses the target script, preserve it locally without an AI request.
6. Increment the AI harness and core versions so older cache entries are not reused under the new policy.

## Consequences

- A provider defect no longer discards successful translations from unrelated units.
- Every format adapter receives a complete translation map and can reconstruct a document.
- Warnings expose local source-preserving fallbacks instead of presenting them as translated content.
- Already-target documents complete quickly and do not consume provider quota.
- A completed document can contain a small amount of source text when bounded repair cannot produce a safer result.

## Verification

- Unit and integration tests cover alternate response shapes, bounded missing-id fallback, target-language detection, source-echo fallback, and protected-token isolation.
- OpenAI Responses live testing completed all 34 Markdown files in the temporary `MindustryAI/docs` corpus without modifying source files.
