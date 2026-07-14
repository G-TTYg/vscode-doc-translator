import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { translateDocument } from "../src/core/application/translateDocument";
import { FakeTranslationProvider } from "../src/core/providers/fakeProvider";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vdt-phase2-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("Phase 2 format adapters", () => {
  it("translates MDX markdown text while preserving imports and JSX blocks", async () => {
    const sourcePath = path.join(tempDir, "page.mdx");
    await fs.writeFile(
      sourcePath,
      [
        "import Widget from './Widget'",
        "",
        "# Product Overview",
        "",
        "<Widget title=\"Keep me\" />",
        "",
        "Use the product carefully."
      ].join("\n"),
      "utf8"
    );

    const result = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: new FakeTranslationProvider(),
      now: new Date("2026-07-14T10:00:00Z")
    });

    const translated = await fs.readFile(result.targetPath, "utf8");
    expect(translated).toContain("import Widget from './Widget'");
    expect(translated).toContain("# [zh-CN] Product Overview");
    expect(translated).toContain("<Widget title=\"Keep me\" />");
    expect(translated).toContain("[zh-CN] Use the product carefully.");
    expect(result.metadata.format.adapter).toBe("mdx");
  });

  it("translates HTML text nodes while preserving tags and script contents", async () => {
    const sourcePath = path.join(tempDir, "page.html");
    await fs.writeFile(
      sourcePath,
      [
        "<html>",
        "<body>",
        "<h1>Hello</h1>",
        "<p>Read the guide.</p>",
        "<script>const text = 'Do not translate';</script>",
        "</body>",
        "</html>"
      ].join("\n"),
      "utf8"
    );

    const result = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: new FakeTranslationProvider(),
      now: new Date("2026-07-14T10:00:00Z")
    });

    const translated = await fs.readFile(result.targetPath, "utf8");
    expect(translated).toContain("<h1>[zh-CN] Hello</h1>");
    expect(translated).toContain("<p>[zh-CN] Read the guide.</p>");
    expect(translated).toContain("const text = 'Do not translate';");
    expect(result.metadata.format.adapter).toBe("html-xml");
  });
});
