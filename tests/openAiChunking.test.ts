import { describe, expect, it } from "vitest";
import {
  type AiSegmentationBudget,
  OpenAiCompatibleProvider,
  chunkOrderedDocumentContext
} from "../src/core/providers/openAiCompatibleProvider";
import type { OrderedDocumentContext } from "../src/core/domain/types";

describe("OpenAI-compatible chunking", () => {
  it("keeps legacy maximum character chunking compatible", () => {
    const context = createContext([
      "short text",
      "another short text",
      "x".repeat(1200),
      "tail"
    ]);

    const chunks = chunkOrderedDocumentContext(context, 1100);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((chunk) => chunk.translationUnitIds)).toEqual([
      "unit-0",
      "unit-1",
      "unit-2",
      "unit-3"
    ]);
    expect(chunks.some((chunk) => chunk.oversizedUnitIds.includes("unit-2"))).toBe(true);
  });

  it("expands reference context around the requested translation ids", () => {
    const context = createContext([
      "a".repeat(180),
      "b".repeat(180),
      "c".repeat(180),
      "d".repeat(180),
      "e".repeat(180),
      "f".repeat(180)
    ]);

    const chunks = chunkOrderedDocumentContext(context, 1600);
    const chunkWithReference = chunks.find(
      (chunk) => chunk.context.units.length > chunk.translationUnitIds.length
    );

    expect(chunkWithReference).toBeDefined();
    expect(chunkWithReference?.translationUnitIds.every((id) =>
      chunkWithReference.context.units.some((unit) => unit.id === id)
    )).toBe(true);
  });

  it("uses max output tokens to limit each translation target range", () => {
    const context = createContext([
      "a".repeat(600),
      "b".repeat(600),
      "c".repeat(600),
      "d".repeat(600)
    ]);

    const chunks = chunkOrderedDocumentContext(context, testBudget({ maxOutputTokens: 360 }));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.translationUnitIds.length <= 1)).toBe(true);
    expect(chunks.flatMap((chunk) => chunk.translationUnitIds)).toEqual([
      "unit-0",
      "unit-1",
      "unit-2",
      "unit-3"
    ]);
  });

  it("translates every chunk and merges flat JSON translations", async () => {
    const requestedTranslationIds: string[] = [];
    const referenceUnitCounts: number[] = [];
    const targetUnitCounts: number[] = [];
    const maxTokensValues: number[] = [];
    const provider = new OpenAiCompatibleProvider({
      endpoint: "https://example.test/v1",
      apiKey: "test-key",
      model: "test-model",
      maxContextTokens: 4000,
      maxOutputTokens: 256,
      charactersPerToken: 2,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          max_tokens?: number;
          messages: Array<{ role: string; content: string }>;
        };
        maxTokensValues.push(body.max_tokens ?? 0);
        const userMessage = body.messages.find((message) => message.role === "user");
        const request = JSON.parse(userMessage?.content ?? "{}") as {
          referenceDocument: OrderedDocumentContext;
          translationUnitIds: string[];
        };
        requestedTranslationIds.push(...request.translationUnitIds);
        referenceUnitCounts.push(request.referenceDocument.units.length);
        targetUnitCounts.push(request.translationUnitIds.length);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    translations: request.translationUnitIds.map((id) => ({
                      id,
                      text: `translated ${id}`
                    }))
                  })
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
    });

    const context = createContext(Array.from({ length: 8 }, (_, index) => String(index).repeat(300)));
    const result = await provider.translateBatch({
      sourceLanguage: "auto",
      targetLanguage: "zh-CN",
      units: context.units,
      orderedContext: context
    });

    expect(result.requestCount).toBeGreaterThan(1);
    expect(maxTokensValues.every((value) => value === 256)).toBe(true);
    expect(requestedTranslationIds).toEqual([
      "unit-0",
      "unit-1",
      "unit-2",
      "unit-3",
      "unit-4",
      "unit-5",
      "unit-6",
      "unit-7"
    ]);
    expect(referenceUnitCounts.some((count, index) => count > targetUnitCounts[index])).toBe(true);
    expect(result.translations.map((translation) => translation.id)).toEqual(requestedTranslationIds);
  });
});

function testBudget(overrides: Partial<AiSegmentationBudget> = {}): AiSegmentationBudget {
  return {
    modelMaxContextTokens: 900,
    maxOutputTokens: 512,
    charactersPerToken: 2,
    promptOverheadTokens: 80,
    outputExpansionRatio: 1.6,
    ...overrides
  };
}

function createContext(texts: readonly string[]): OrderedDocumentContext {
  return {
    documentId: "doc:sha256:test",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
    format: "markdown",
    units: texts.map((text, index) => ({
      id: `unit-${index}`,
      order: index,
      kind: "paragraph",
      sourceText: text,
      protectedTokens: []
    }))
  };
}
