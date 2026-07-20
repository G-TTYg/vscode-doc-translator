import { describe, expect, it } from "vitest";
import {
  type AiSegmentationBudget,
  OpenAiCompatibleProvider,
  chunkOrderedDocumentContext,
  parseTranslations
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

    const chunks = chunkOrderedDocumentContext(context, 2400);
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

  it("recovers wrapped JSON responses and supports explicit skip items", () => {
    const translations = parseTranslations(
      [
        "Here is the JSON:",
        "```json",
        "{",
        "  \"translations\": [",
        "    { \"id\": \"unit-0\", \"text\": \"translated\" },",
        "    { \"id\": \"unit-1\", \"skip\": true },",
        "  ]",
        "}",
        "```"
      ].join("\n"),
      new Map([["unit-1", "Keep as-is"]])
    );

    expect(translations).toEqual([
      { id: "unit-0", text: "translated" },
      { id: "unit-1", text: "Keep as-is", skipped: true }
    ]);
  });

  it("recovers a flat translation mapping keyed by requested ids", () => {
    const translations = parseTranslations(
      JSON.stringify({
        "unit-0": "译文一",
        "unit-1": { text: "译文二", skip: false },
        diagnostic: "must not become a translation"
      }),
      new Map([
        ["unit-0", "Source one"],
        ["unit-1", "Source two"]
      ])
    );

    expect(translations).toEqual([
      { id: "unit-0", text: "译文一" },
      { id: "unit-1", text: "译文二" }
    ]);
  });

  it("recovers a single translation object returned without an array wrapper", () => {
    const translations = parseTranslations(
      JSON.stringify({ id: "unit-0", text: "单项译文", skip: false }),
      new Map([["unit-0", "Single source unit"]])
    );

    expect(translations).toEqual([{ id: "unit-0", text: "单项译文" }]);
  });

  it("retries a chunk once when the response object has no requested translations", async () => {
    const attempts: string[] = [];
    const provider = new OpenAiCompatibleProvider({
      endpoint: "https://example.test/v1",
      apiKey: "test-key",
      model: "test-model",
      maxContextTokens: 8000,
      maxOutputTokens: 1024,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const userMessage = body.messages.find((message) => message.role === "user");
        const request = JSON.parse(userMessage?.content ?? "{}") as {
          attempt: string;
          translationUnitIds: string[];
        };
        attempts.push(request.attempt);
        const content =
          attempts.length === 1
            ? JSON.stringify({ status: "schema_not_followed" })
            : JSON.stringify({
                translations: request.translationUnitIds.map((id) => ({
                  id,
                  text: "已恢复的译文",
                  skip: false
                }))
              });
        return new Response(
          JSON.stringify({ choices: [{ message: { content } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });
    const context = createContext([
      "This source sentence is long enough for the translation quality inspection."
    ]);

    const result = await provider.translateBatch({
      sourceLanguage: "auto",
      targetLanguage: "zh-CN",
      units: context.units,
      orderedContext: context
    });

    expect(attempts).toEqual(["initial", "response-format-repair"]);
    expect(result.requestCount).toBe(2);
    expect(result.translations).toEqual([{ id: "unit-0", text: "已恢复的译文" }]);
    expect(result.warnings.join("\n")).toContain("invalid translation object");
  });

  it("retries only missing translation ids and merges the repair response", async () => {
    const requestedBatches: string[][] = [];
    const provider = new OpenAiCompatibleProvider({
      endpoint: "https://example.test/v1",
      apiKey: "test-key",
      model: "test-model",
      maxContextTokens: 8000,
      maxOutputTokens: 1024,
      charactersPerToken: 2,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const userMessage = body.messages.find((message) => message.role === "user");
        const request = JSON.parse(userMessage?.content ?? "{}") as {
          translationUnitIds: string[];
        };
        requestedBatches.push(request.translationUnitIds);
        const translations =
          requestedBatches.length === 1
            ? [{ id: "unit-0", text: "translated unit-0" }]
            : [
                { id: "unit-1", text: "repaired unit-1" },
                { id: "unit-2", skip: true }
              ];

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ translations })
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
    });

    const context = createContext(["first", "second", "third"]);
    const result = await provider.translateBatch({
      sourceLanguage: "auto",
      targetLanguage: "zh-CN",
      units: context.units,
      orderedContext: context
    });

    expect(requestedBatches).toEqual([
      ["unit-0", "unit-1", "unit-2"],
      ["unit-1", "unit-2"]
    ]);
    expect(result.requestCount).toBe(2);
    expect(result.warnings.join("\n")).toContain("retrying missing unit(s): unit-1, unit-2");
    expect(result.translations).toEqual([
      { id: "unit-0", text: "translated unit-0" },
      { id: "unit-1", text: "repaired unit-1" },
      { id: "unit-2", text: "third", skipped: true }
    ]);
  });

  it("preserves omitted units after the bounded completeness retry", async () => {
    const requestedBatches: string[][] = [];
    const provider = new OpenAiCompatibleProvider({
      endpoint: "https://example.test/v1",
      apiKey: "test-key",
      model: "test-model",
      maxContextTokens: 8000,
      maxOutputTokens: 1024,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const request = JSON.parse(body.messages[1].content) as {
          translationUnitIds: string[];
        };
        requestedBatches.push(request.translationUnitIds);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    id: request.translationUnitIds[0],
                    text: `translated ${request.translationUnitIds[0]}`,
                    skip: false
                  })
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
    });
    const context = createContext(["first source", "second source", "third source"]);

    const result = await provider.translateBatch({
      sourceLanguage: "auto",
      targetLanguage: "zh-CN",
      units: context.units,
      orderedContext: context
    });

    expect(requestedBatches).toEqual([
      ["unit-0", "unit-1", "unit-2"],
      ["unit-1", "unit-2"]
    ]);
    expect(result.requestCount).toBe(2);
    expect(result.translations).toEqual([
      { id: "unit-0", text: "translated unit-0" },
      { id: "unit-1", text: "translated unit-1" },
      { id: "unit-2", text: "third source", preservedSource: true }
    ]);
    expect(result.warnings.join("\n")).toContain(
      "kept source text for 1 omitted unit(s); the document translation continued"
    );
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
