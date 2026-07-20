import { describe, expect, it } from "vitest";
import type { OrderedDocumentContext, TranslateRequest } from "../src/core/domain/types";
import { AnthropicProvider } from "../src/core/providers/anthropicProvider";
import { GeminiProvider } from "../src/core/providers/geminiProvider";
import { OpenAiResponsesProvider } from "../src/core/providers/openAiResponsesProvider";

describe("native LLM API providers", () => {
  it("uses the OpenAI Responses API and structured output format", async () => {
    let requestUrl = "";
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> = {};
    const provider = new OpenAiResponsesProvider({
      endpoint: "https://api.openai.test/v1/",
      apiKey: "openai-key",
      model: "gpt-test",
      maxContextTokens: 8000,
      maxOutputTokens: 512,
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestHeaders = new Headers(init?.headers);
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: translationJson("Bonjour")
                }
              ]
            }
          ]
        });
      }
    });

    const result = await provider.translateBatch(createRequest());

    expect(requestUrl).toBe("https://api.openai.test/v1/responses");
    expect(requestHeaders?.get("authorization")).toBe("Bearer openai-key");
    expect(requestBody).toMatchObject({
      model: "gpt-test",
      max_output_tokens: 512,
      store: false,
      text: { format: { type: "json_schema", name: "translation_batch", strict: true } }
    });
    expect(JSON.parse(String(requestBody.input))).toMatchObject({
      translationUnitIds: ["unit-0"]
    });
    expect(result.translations).toEqual([{ id: "unit-0", text: "Bonjour" }]);
  });

  it("uses Anthropic Messages with the required version and output schema", async () => {
    let requestUrl = "";
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> = {};
    const provider = new AnthropicProvider({
      endpoint: "https://api.anthropic.test",
      apiKey: "anthropic-key",
      model: "claude-test",
      maxContextTokens: 8000,
      maxOutputTokens: 512,
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestHeaders = new Headers(init?.headers);
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          content: [{ type: "text", text: translationJson("Bonjour") }],
          stop_reason: "end_turn"
        });
      }
    });

    const result = await provider.translateBatch(createRequest());

    expect(requestUrl).toBe("https://api.anthropic.test/v1/messages");
    expect(requestHeaders?.get("x-api-key")).toBe("anthropic-key");
    expect(requestHeaders?.get("anthropic-version")).toBe("2023-06-01");
    expect(requestBody).toMatchObject({
      model: "claude-test",
      max_tokens: 512,
      output_config: { format: { type: "json_schema" } }
    });
    expect(result.translations).toEqual([{ id: "unit-0", text: "Bonjour" }]);
  });

  it("uses Gemini GenerateContent with API-key auth and responseJsonSchema", async () => {
    let requestUrl = "";
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> = {};
    const provider = new GeminiProvider({
      endpoint: "https://generativelanguage.test/v1beta/",
      apiKey: "gemini-key",
      model: "gemini-test",
      maxContextTokens: 8000,
      maxOutputTokens: 512,
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestHeaders = new Headers(init?.headers);
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          candidates: [
            {
              content: { parts: [{ text: translationJson("Bonjour") }] },
              finishReason: "STOP"
            }
          ]
        });
      }
    });

    const result = await provider.translateBatch(createRequest());

    expect(requestUrl).toBe(
      "https://generativelanguage.test/v1beta/models/gemini-test:generateContent"
    );
    expect(requestHeaders?.get("x-goog-api-key")).toBe("gemini-key");
    expect(requestBody).toMatchObject({
      generationConfig: {
        maxOutputTokens: 512,
        responseMimeType: "application/json",
        responseJsonSchema: { type: "object" }
      }
    });
    expect(result.translations).toEqual([{ id: "unit-0", text: "Bonjour" }]);
  });
});

function createRequest(): TranslateRequest {
  const orderedContext: OrderedDocumentContext = {
    documentId: "test-document",
    sourceLanguage: "auto",
    targetLanguage: "fr",
    format: "markdown",
    units: [
      {
        id: "unit-0",
        order: 0,
        kind: "paragraph",
        sourceText: "Hello",
        protectedTokens: []
      }
    ]
  };
  return {
    sourceLanguage: "auto",
    targetLanguage: "fr",
    units: orderedContext.units,
    orderedContext
  };
}

function translationJson(text: string): string {
  return JSON.stringify({
    translations: [{ id: "unit-0", text, skip: false }]
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
