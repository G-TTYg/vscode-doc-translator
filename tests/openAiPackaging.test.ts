import { describe, expect, it } from "vitest";
import { MarkdownAdapter } from "../src/core/formats/markdownAdapter";

describe("ordered JSON context", () => {
  it("builds ordered context for LLM providers", async () => {
    const adapter = new MarkdownAdapter();
    const document = await adapter.parse({
      sourcePath: "guide.md",
      text: "# Title\n\nA paragraph with `code`.\n"
    });
    const units = await adapter.extractUnits(document);
    const context = await adapter.buildOrderedJsonContext(document, units, {
      documentId: "guide.md:sha256:test",
      sourceLanguage: "auto",
      targetLanguage: "zh-CN"
    });

    expect(context.units).toHaveLength(2);
    expect(context.units.map((unit) => unit.order)).toEqual([0, 1]);
    expect(context.units[1].sourceText).toContain("__VDT_PROTECTED_0__");
    expect(context.units[1].protectedTokens[0].value).toBe("`code`");
  });
});
