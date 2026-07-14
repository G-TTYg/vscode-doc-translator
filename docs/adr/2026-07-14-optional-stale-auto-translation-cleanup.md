# ADR 2026-07-14: Optional Stale Auto-Translation Cleanup

Status: Accepted
Date: 2026-07-14

## Context

Doc Translator creates timestamped auto-translated files. When the source document changes, the previous translation no longer matches the fresh cache criteria, so a new translated file is created. Keeping every old auto translation is safe, but it can clutter the source directory for users who translate the same document repeatedly.

The project also treats translated files as user-editable artifacts. A stale translated file may contain manual edits that must not be deleted silently.

## Decision

Add `docTranslator.cache.deleteStaleAutoTranslations`, defaulting to `false`.

When enabled, cleanup runs only after a new translation has been successfully written. It is scoped to metadata for the same source file, target language, provider, and output directory mode. A stale translated file is deleted only when its current SHA-256 hash still matches `metadata.target.sha256`, proving it is still the unedited auto-generated artifact. The paired metadata sidecar is deleted with it.

If the translated file hash differs from metadata, cleanup skips both the translated file and its metadata because the file is treated as user-edited. Metadata that points to a missing target file may be removed as orphaned cache state.

## Consequences

- Default behavior remains conservative: old auto translations are kept.
- Users who opt in can keep repeat translations tidy without deleting manually edited translations.
- The deletion rule remains in the shared core metadata store, not the VS Code UI layer.
- Cleanup depends on metadata integrity and path guards; metadata target paths outside the source directory are ignored.

## References

- `src/core/application/metadataStore.ts`
- `src/core/application/translateDocument.ts`
- `docs/design.md`
- `docs/architecture.md`
