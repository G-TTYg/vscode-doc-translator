import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { translateDocument } from "../src/core/application/translateDocument";
import { FakeTranslationProvider } from "../src/core/providers/fakeProvider";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vdt-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("translateDocument", () => {
  it("translates plain text, writes metadata, and reuses a fresh cached artifact", async () => {
    const sourcePath = path.join(tempDir, "notes.txt");
    await fs.writeFile(sourcePath, "Hello world\n\nSecond paragraph\n", "utf8");

    const first = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: new FakeTranslationProvider(),
      now: new Date("2026-07-13T15:02:45Z")
    });

    expect(first.status).toBe("translated");
    expect(path.basename(first.targetPath)).toBe("notes.auto.zh-CN.20260713T150245Z.txt");
    expect(first.metadataPath).toContain(".vscode-doc-translator-cache");

    const translated = await fs.readFile(first.targetPath, "utf8");
    expect(translated).toContain("[zh-CN] Hello world");
    expect(translated).toContain("[zh-CN] Second paragraph");

    const metadata = JSON.parse(await fs.readFile(first.metadataPath, "utf8")) as {
      source: { sha256: string };
      target: { sha256: string };
      provider: { requestPackaging: string };
      pipeline: { segmentCount: number };
    };
    expect(metadata.source.sha256).toHaveLength(64);
    expect(metadata.target.sha256).toHaveLength(64);
    expect(metadata.provider.requestPackaging).toBe("segmented-units");
    expect(metadata.pipeline.segmentCount).toBe(2);
    expect(metadata.pipeline.requestCount).toBe(1);

    const second = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: new FakeTranslationProvider(),
      now: new Date("2026-07-13T16:00:00Z")
    });

    expect(second.status).toBe("cached");
    expect(second.targetPath).toBe(first.targetPath);
  });

  it("writes translated documents into the hidden cache directory when requested", async () => {
    const sourcePath = path.join(tempDir, "hidden.txt");
    await fs.writeFile(sourcePath, "Keep the source directory tidy.\n", "utf8");

    const visible = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: new FakeTranslationProvider(),
      now: new Date("2026-07-13T15:02:45Z")
    });

    const hidden = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: new FakeTranslationProvider(),
      outputDirectoryMode: "hidden-cache",
      now: new Date("2026-07-13T16:00:00Z")
    });

    expect(visible.status).toBe("translated");
    expect(hidden.status).toBe("translated");
    expect(path.dirname(hidden.targetPath)).toBe(
      path.join(tempDir, ".vscode-doc-translator-cache")
    );
    expect(hidden.metadata.target.directoryMode).toBe("hidden-cache");
    expect(hidden.metadata.target.relativePath).toBe(
      ".vscode-doc-translator-cache/hidden.auto.zh-CN.20260713T160000Z.txt"
    );

    const cachedHidden = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: new FakeTranslationProvider(),
      outputDirectoryMode: "hidden-cache",
      now: new Date("2026-07-13T17:00:00Z")
    });

    expect(cachedHidden.status).toBe("cached");
    expect(cachedHidden.targetPath).toBe(hidden.targetPath);
  });

  it("retranslates when the source hash changes", async () => {
    const sourcePath = path.join(tempDir, "changing.txt");
    await fs.writeFile(sourcePath, "Original text.\n", "utf8");

    const first = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: new FakeTranslationProvider(),
      now: new Date("2026-07-13T15:02:45Z")
    });

    await fs.writeFile(sourcePath, "Updated text.\n", "utf8");

    const second = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: new FakeTranslationProvider(),
      now: new Date("2026-07-13T16:00:00Z")
    });

    expect(second.status).toBe("translated");
    expect(second.targetPath).not.toBe(first.targetPath);
    expect(second.metadata.source.sha256).not.toBe(first.metadata.source.sha256);
    await expect(fs.readFile(second.targetPath, "utf8")).resolves.toContain(
      "[zh-CN] Updated text."
    );
  });

  it("translates Markdown text while preserving code fences and link targets", async () => {
    const sourcePath = path.join(tempDir, "guide.md");
    await fs.writeFile(
      sourcePath,
      [
        "---",
        "title: Keep this metadata",
        "---",
        "",
        "# Quick Start",
        "",
        "Read [the docs](https://example.com/docs) before using `run()`.",
        "",
        "```ts",
        "const label = 'Do not translate';",
        "```",
        "",
        "| Name | Meaning |",
        "| --- | --- |",
        "| Hello | World |",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: new FakeTranslationProvider(),
      now: new Date("2026-07-13T15:02:45Z"),
      insertMarkdownHeader: true
    });

    const translated = await fs.readFile(result.targetPath, "utf8");
    expect(translated).toContain("<!-- Auto-translated by VSCode Doc Translator.");
    expect(translated).toContain("# [zh-CN] Quick Start");
    expect(translated).toContain("[the docs](https://example.com/docs)");
    expect(translated).toContain("`run()`");
    expect(translated).toContain("const label = 'Do not translate';");
    expect(translated).toContain("| [zh-CN] Hello | [zh-CN] World |");
    expect(result.metadata.pipeline.markdownHeaderInserted).toBe(true);
    expect(result.metadata.format.adapter).toBe("markdown");
  });

  it("keeps configured term locks untranslated", async () => {
    const sourcePath = path.join(tempDir, "terms.txt");
    await fs.writeFile(sourcePath, "OpenAI and VS Code should stay locked.\n", "utf8");

    const result = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: new FakeTranslationProvider(),
      now: new Date("2026-07-13T15:02:45Z"),
      termLocks: ["OpenAI", "VS Code"]
    });

    const translated = await fs.readFile(result.targetPath, "utf8");
    expect(translated).toContain("OpenAI");
    expect(translated).toContain("VS Code");
    expect(translated).not.toContain("__VDT_TERM_");
  });

  it("does not treat a UTF-8 BOM as translatable content", async () => {
    const sourcePath = path.join(tempDir, "bom.md");
    await fs.writeFile(sourcePath, Buffer.from("\uFEFF# Hello\n", "utf8"));

    const result = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: new FakeTranslationProvider(),
      now: new Date("2026-07-13T15:02:45Z")
    });

    const translated = await fs.readFile(result.targetPath, "utf8");
    expect(translated).toBe("# [zh-CN] Hello\n");
  });
});
