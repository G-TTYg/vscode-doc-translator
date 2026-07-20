# Changelog

## 0.2.3

- Made AI translation completion-oriented: unrepaired source echoes and omitted ids now fall back per unit instead of failing the whole document.
- Added recovery for flat id maps, single translation objects, and one malformed response-format retry.
- Detect documents already written in the selected target language and avoid unnecessary AI calls.
- Isolated protected-token repair context and detect duplicated or cross-unit token leakage.
- Validated the OpenAI Responses provider against a 34-file Markdown corpus with all files completing successfully.

## 0.2.2

- Made AI protected-token handling success-oriented: normalize common model rewrites, retry only affected units, and complete with a source-preserving fallback when repair still fails.
- Made Markdown protected tokens unique across the document to avoid conflicting placeholder meanings.
- Added explicit protected-content mappings and stronger token instructions to AI requests.
- Show successful translations with warnings instead of failing the whole document for unrepaired protected units.

## 0.2.1

- Added source-echo detection and one focused repair attempt for all AI providers.
- Abort before writing when an AI response still leaves at least half of meaningful source units unchanged.
- Strengthened target-language prompts and `skip` handling.
- Added model, endpoint, token-budget, harness, and core-version cache isolation.
- Added regression coverage for failed, repaired, and already-target-language responses.

## 0.2.0

- Added native OpenAI Responses API support with JSON Schema structured output.
- Added native Anthropic Messages API support.
- Added native Gemini GenerateContent API support.
- Added provider-specific visual settings and SecretStorage entries.
- Added English and Simplified Chinese marketplace documentation.

## 0.1.1

- Added an alphabetically sorted target-language selector.
- Added optional cleanup of stale, unedited auto-translated files.
- Improved the visual settings panel and provider configuration.
