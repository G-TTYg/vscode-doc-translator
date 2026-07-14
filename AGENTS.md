# AGENTS.md

## Project Scope

- Project root: `D:\Users\g-tty\Documents\VSCode_Doc_Translator`
- Monorepo subproject: none yet.

## Project Purpose

- This project will build a VS Code document translator that can translate a whole document from the editor context menu, explorer context menu, command palette, or CLI while preserving document structure and formatting as much as possible.
- The translator will support multiple backends through adapters: Google Translation API, DeepL API, Microsoft Translator, and OpenAI-compatible LLM APIs.
- The translator will save a translated copy and a coupled hidden sidecar under `.vscode-doc-translator-cache/` next to the source document so VS Code can open the translated copy as a normal file.
- Non-goals for the first implementation: arbitrary binary office/PDF fidelity, machine translation account management, and replacing dedicated CAT/TMS tools.
- Primary users: VS Code users who need quick whole-document translation with reproducible cache metadata and low manual cleanup.

## Required Reading Before Work

1. `README.md`
2. `docs/design.md`
3. `docs/architecture.md`
4. Relevant ADRs under `docs/adr/`
5. Nearby source code and tests for the area being changed
6. Recent project-local logs under `logs/` when continuing prior work

## Project Map

- `docs/design.md` - product requirements, user flows, cache naming, provider behavior, roadmap, and open questions.
- `docs/architecture.md` - planned layered architecture, module boundaries, data flow, and verification strategy.
- `docs/adr/` - durable architecture and product decisions.
- `logs/` - dated project-local work logs and handoff notes.
- `src/core/domain/` - shared contracts, naming, hashing, protected-token utilities.
- `src/core/formats/` - plain text and Markdown format adapters.
- `src/core/providers/` - provider boundary, fake/OpenAI-compatible/DeepL/Google/Microsoft providers, batching helpers.
- `src/core/application/` - `translateDocument` use case and metadata/cache store.
- `src/cli/` - CLI entrypoint.
- `src/extension/` - VS Code extension entrypoint and settings webview.
- `tests/` - Vitest unit/integration tests.

## Commands

- Install: `npm install`
- Compile: `npm run compile`
- Test: `npm test`
- Check: `npm run check`
- CLI smoke: `node dist/cli/main.js translate <file> --to zh-CN --provider fake`
- CLI hidden output smoke: `node dist/cli/main.js translate <file> --to zh-CN --provider fake --output hidden-cache`
- AI large-file smoke: `node dist/cli/main.js translate <file> --to zh-CN --provider openai-compatible --llm-max-context-tokens 128000 --llm-max-output-tokens 4096`
- Build/package: TBD

## Architecture Rules

- Keep VS Code UI, CLI entrypoints, application workflows, domain rules, provider adapters, format adapters, and persistence/cache concerns separate.
- Shared translation behavior must live in reusable core modules consumed by both the VS Code extension and CLI.
- Provider-specific details must stay behind translation provider interfaces.
- File-format-specific parsing and reconstruction must stay behind document format adapter interfaces.
- Traditional machine translation providers should receive segmented translation units. AI/LLM providers may receive an ordered JSON representation of the full extracted document context, with stable IDs, but must return a flat JSON mapping from IDs to translations.
- Format reconstruction must remain owned by document format adapters; providers never own final file rendering.
- Do not add dependencies or external services without documenting why in `docs/design.md`, `docs/architecture.md`, or an ADR.
- Do not store API keys, bearer tokens, or provider secrets in metadata/cache files.
- Treat translated files as user-editable artifacts; avoid overwriting them when their recorded hash no longer matches.

## Documentation Rules

- Update README/docs when commands, behavior, APIs, setup, cache schema, naming conventions, provider support, or architecture change.
- Record significant decisions in `docs/adr/`.
- Update Mermaid diagrams when system boundaries or dependencies change.

## Logging Rules

- For non-trivial work, append `logs/YYYY-MM-DD.md` with plan, discoveries, verification, and risks.
- Do not mix logs from other repos or global agent memory.
- Do not log secrets or sensitive personal data.

## Verification Rules

- Run the narrowest relevant test first.
- Run lint/typecheck/build when touching shared code or before handoff once implementation exists.
- If checks cannot run, explain why and what remains unverified.

## Safety Rules

- Ask before destructive migrations, deletion of user documents/cache, publishing/deployment, or security posture changes.
- Never overwrite a source document during translation.
- Never overwrite an edited translated artifact without explicit user confirmation or a new versioned output name.
