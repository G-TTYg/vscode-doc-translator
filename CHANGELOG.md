# Changelog

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
