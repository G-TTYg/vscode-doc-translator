import { describe, expect, it } from "vitest";
import { MarkdownAdapter } from "../src/core/formats/markdownAdapter";
import { createAiTranslationPayload } from "../src/core/providers/openAiCompatibleProvider";

describe("ordered JSON context", () => {
  it("builds ordered context for LLM providers", async () => {
    const adapter = new MarkdownAdapter();
    const document = await adapter.parse({
      sourcePath: "guide.md",
      text: "# Title\n\nA paragraph with `code`.\n\nAnother paragraph links to https://example.com/private.\n"
    });
    const units = await adapter.extractUnits(document);
    const context = await adapter.buildOrderedJsonContext(document, units, {
      documentId: "guide.md:sha256:test",
      sourceLanguage: "auto",
      targetLanguage: "zh-CN"
    });

    expect(context.units).toHaveLength(3);
    expect(context.units.map((unit) => unit.order)).toEqual([0, 1, 2]);
    expect(context.units[1].sourceText).toContain("__VDT_PROTECTED_1_0__");
    expect(context.units[2].sourceText).toContain("__VDT_PROTECTED_2_0__");
    expect(context.units[1].protectedTokens[0].token).not.toBe(
      context.units[2].protectedTokens[0].token
    );
    expect(context.units[1].protectedTokens[0].value).toBe("`code`");

    const payload = createAiTranslationPayload({
      attempt: "initial",
      sourceLanguage: "auto",
      targetLanguage: "zh-CN",
      referenceDocument: context,
      translationUnitIds: context.units.map((unit) => unit.id)
    });
    expect(payload.referenceDocument.units[1].requiredProtectedTokens).toEqual([
      "__VDT_PROTECTED_1_0__"
    ]);
    expect(payload.referenceDocument.units[1].protectedContent).toEqual([
      { token: "__VDT_PROTECTED_1_0__", originalText: "`code`" }
    ]);
  });
});
