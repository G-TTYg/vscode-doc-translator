import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { translateDocument } from "../src/core/application/translateDocument";
import type {
  OrderedDocumentContext,
  TranslateRequest
} from "../src/core/domain/types";
import { OpenAiCompatibleProvider } from "../src/core/providers/openAiCompatibleProvider";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

describe("AI translation quality harness", () => {
  it("retries echoed source units once and replaces them with repaired translations", async () => {
    const requests: Array<{ attempt: string; ids: string[]; system: string }> = [];
    const context = createContext([
      "The 中文 roadmap explains the major implementation milestones for the next release.",
      "This section describes how contributors can validate each completed feature.",
      "Release planning must keep compatibility and user data safety in view."
    ]);
    const provider = createProvider(async (_input, init) => {
      const request = readChatRequest(init);
      requests.push(request);
      const translations = request.ids.map((id) => ({
        id,
        text:
          request.attempt === "initial" && id !== "unit-2"
            ? decorateEcho(
                context.units.find((unit) => unit.id === id)?.sourceText ?? "",
                id
              )
            : `已修复的译文 ${id}`,
        skip: false
      }));
      return chatResponse(translations);
    });

    const result = await provider.translateBatch(createRequest(context));

    expect(requests.map((request) => request.attempt)).toEqual(["initial", "unchanged-repair"]);
    expect(requests[1].ids).toEqual(["unit-0", "unit-1"]);
    expect(requests[1].system).toContain("QUALITY REPAIR");
    expect(requests[1].system).toContain("zh-CN");
    expect(result.requestCount).toBe(2);
    expect(result.translations.map((translation) => translation.text)).toEqual([
      "已修复的译文 unit-0",
      "已修复的译文 unit-1",
      "已修复的译文 unit-2"
    ]);
    expect(result.warnings.join("\n")).toContain("echoed source text");
  });

  it("accepts unchanged text that is already written in the target script", async () => {
    let requestCount = 0;
    const context = createContext(["这段内容已经是简体中文，不需要再次翻译。"]);
    const provider = createProvider(async (_input, init) => {
      requestCount += 1;
      const request = readChatRequest(init);
      return chatResponse(request.ids.map((id) => ({ id, skip: true })));
    });

    const result = await provider.translateBatch(createRequest(context));

    expect(requestCount).toBe(1);
    expect(result.requestCount).toBe(1);
    expect(result.translations).toEqual([
      { id: "unit-0", text: "这段内容已经是简体中文，不需要再次翻译。", skipped: true }
    ]);
  });

  it("rejects repeated source echo before writing a translated artifact", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "roadmap.md");
    await fs.writeFile(
      sourcePath,
      [
        "# Roadmap",
        "",
        "The roadmap explains the major implementation milestones for the next release.",
        "",
        "This section describes how contributors can validate each completed feature."
      ].join("\n"),
      "utf8"
    );
    let requestCount = 0;
    const provider = createProvider(async (_input, init) => {
      requestCount += 1;
      const body = readChatBody(init);
      const payload = JSON.parse(body.messages[1].content) as {
        referenceDocument: OrderedDocumentContext;
        translationUnitIds: string[];
      };
      const sourceById = new Map(
        payload.referenceDocument.units.map((unit) => [unit.id, unit.sourceText])
      );
      return chatResponse(
        payload.translationUnitIds.map((id) => ({
          id,
          text: sourceById.get(id) ?? "",
          skip: false
        }))
      );
    });

    await expect(
      translateDocument({ sourcePath, targetLanguage: "zh-CN", provider })
    ).rejects.toThrow("remained identical to the source after a focused retry");

    expect(requestCount).toBe(2);
    expect(await fs.readdir(directory)).toEqual(["roadmap.md"]);
  });

  it("does not reuse an AI cache entry created by a different model", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "cache.txt");
    await fs.writeFile(
      sourcePath,
      "Cache identity must include the selected model and translation harness version.\n",
      "utf8"
    );
    let firstCalls = 0;
    const firstProvider = createProvider(async (_input, init) => {
      firstCalls += 1;
      const request = readChatRequest(init);
      return chatResponse(request.ids.map((id) => ({ id, text: "第一版译文", skip: false })));
    }, "model-a");
    const first = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: firstProvider,
      now: new Date("2026-07-20T04:00:00Z")
    });

    let secondCalls = 0;
    const secondProvider = createProvider(async (_input, init) => {
      secondCalls += 1;
      const request = readChatRequest(init);
      return chatResponse(request.ids.map((id) => ({ id, text: "第二版译文", skip: false })));
    }, "model-b");
    const second = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: secondProvider,
      now: new Date("2026-07-20T04:01:00Z")
    });

    const cachedProvider = createProvider(async () => {
      throw new Error("matching model should have reused its cache entry");
    }, "model-b");
    const cached = await translateDocument({
      sourcePath,
      targetLanguage: "zh-CN",
      provider: cachedProvider,
      now: new Date("2026-07-20T04:02:00Z")
    });

    expect(first.status).toBe("translated");
    expect(second.status).toBe("translated");
    expect(cached.status).toBe("cached");
    expect(cached.targetPath).toBe(second.targetPath);
    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(1);
    expect(first.metadata.provider.modelOrApiVersion).toBe("model-a");
    expect(second.metadata.provider.modelOrApiVersion).toBe("model-b");
    expect(second.metadata.provider.endpointLabel).toBe("https://example.test/v1");
    expect(second.metadata.provider.harnessVersion).toBe("2");
    expect(second.metadata.profile.hash).not.toBe(first.metadata.profile.hash);
  });
});

function createProvider(fetchImplementation: typeof fetch, model = "test-model") {
  return new OpenAiCompatibleProvider({
    endpoint: "https://example.test/v1?secret=not-metadata",
    apiKey: "test-key",
    model,
    maxContextTokens: 8000,
    maxOutputTokens: 1024,
    fetch: fetchImplementation
  });
}

function createContext(texts: readonly string[]): OrderedDocumentContext {
  return {
    documentId: "quality-harness-test",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
    format: "markdown",
    units: texts.map((sourceText, order) => ({
      id: `unit-${order}`,
      order,
      kind: "paragraph" as const,
      sourceText,
      protectedTokens: []
    }))
  };
}

function createRequest(context: OrderedDocumentContext): TranslateRequest {
  return {
    sourceLanguage: context.sourceLanguage,
    targetLanguage: context.targetLanguage,
    units: context.units,
    orderedContext: context
  };
}

function readChatRequest(init?: RequestInit): { attempt: string; ids: string[]; system: string } {
  const body = readChatBody(init);
  const payload = JSON.parse(body.messages[1].content) as {
    attempt: string;
    translationUnitIds: string[];
  };
  return {
    attempt: payload.attempt,
    ids: payload.translationUnitIds,
    system: body.messages[0].content
  };
}

function readChatBody(init?: RequestInit): {
  messages: Array<{ role: string; content: string }>;
} {
  return JSON.parse(String(init?.body)) as {
    messages: Array<{ role: string; content: string }>;
  };
}

function chatResponse(translations: readonly Record<string, unknown>[]): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ translations }) } }]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

async function createTempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-doc-translator-ai-"));
  tempDirectories.push(directory);
  return directory;
}

function decorateEcho(sourceText: string, id: string): string {
  return id === "unit-1" ? `“${sourceText}”` : sourceText;
}
