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

  it("accepts Chinese technical prose even when Latin identifiers are frequent", async () => {
    let requestCount = 0;
    const source =
      "Level2 使用 pinned Mindustry Java runtime 作为真实行为 oracle，并验证 canonical layout hash。";
    const context = createContext([source]);
    const provider = createProvider(async (_input, init) => {
      requestCount += 1;
      const request = readChatRequest(init);
      return chatResponse(request.ids.map((id) => ({ id, text: source, skip: true })));
    });

    const result = await provider.translateBatch(createRequest(context));

    expect(requestCount).toBe(1);
    expect(result.requestCount).toBe(1);
    expect(result.translations).toEqual([{ id: "unit-0", text: source, skipped: true }]);
    expect(result.warnings).toEqual([]);
  });

  it("skips API requests when an auto-detected document already uses the target language", async () => {
    let requestCount = 0;
    const context = createContext([
      "这是一份已经使用简体中文编写的技术文档，介绍项目目标、实现范围和验证方法。",
      "文档包含完整的中文说明，同时保留必要的 API、runtime 和 layout 等技术术语。"
    ]);
    const provider = createProvider(async () => {
      requestCount += 1;
      throw new Error("an already translated document must not call the API");
    });

    const result = await provider.translateBatch(createRequest(context));

    expect(requestCount).toBe(0);
    expect(result.requestCount).toBe(0);
    expect(result.translations).toEqual(
      context.units.map((unit) => ({ id: unit.id, text: unit.sourceText, skipped: true }))
    );
    expect(result.warnings.join("\n")).toContain("already uses zh-CN");
  });

  it("recognizes code-heavy Chinese documents at document scope", async () => {
    let requestCount = 0;
    const context = createContext([
      "本文定义 compiler runtime adapter projection semantics validation architecture。",
      "实现通过 TypeScript OpenAI Responses API JSON Schema cache metadata provider。",
      "这些中文说明用于连接大量英文技术标识符，并保持文档结构和术语不变。"
    ]);
    const provider = createProvider(async () => {
      requestCount += 1;
      throw new Error("a code-heavy Chinese document must not call the API");
    });

    const result = await provider.translateBatch(createRequest(context));

    expect(requestCount).toBe(0);
    expect(result.requestCount).toBe(0);
    expect(result.warnings.join("\n")).toContain("already uses zh-CN");
  });

  it("does not skip an English document containing a short Chinese example", async () => {
    let requestCount = 0;
    const context = createContext([
      "This English guide includes the short Chinese example 你好世界, but the document still needs translation."
    ]);
    const provider = createProvider(async (_input, init) => {
      requestCount += 1;
      const request = readChatRequest(init);
      return chatResponse(request.ids.map((id) => ({ id, text: "这份英文指南仍需翻译。", skip: false })));
    });

    const result = await provider.translateBatch(createRequest(context));

    expect(requestCount).toBe(1);
    expect(result.requestCount).toBe(1);
    expect(result.translations[0].text).toBe("这份英文指南仍需翻译。");
  });

  it("normalizes original and escaped tokens, then retries only genuinely missing tokens", async () => {
    const requests: Array<{ attempt: string; ids: string[]; body: string; contextIds: string[] }> = [];
    const context = createProtectedContext();
    const provider = createProvider(async (_input, init) => {
      const request = readChatRequest(init);
      const body = readChatBody(init);
      const payload = JSON.parse(body.messages[1].content) as {
        referenceDocument: { units: Array<{ id: string }> };
      };
      requests.push({
        ...request,
        body: String(init?.body),
        contextIds: payload.referenceDocument.units.map((unit) => unit.id)
      });
      if (request.attempt === "initial") {
        return chatResponse([
          {
            id: "unit-0",
            text: "请先阅读 https://example.com/private 私有文档。",
            skip: false
          },
          {
            id: "unit-1",
            text: "运行 \\_\\_VDT\\_PROTECTED\\_1\\_0\\_\\_ 命令。",
            skip: false
          },
          { id: "unit-2", text: "打开组件预览。", skip: false }
        ]);
      }
      return chatResponse([
        {
          id: "unit-2",
          text: "打开 __VDT_PROTECTED_2_0__ 组件预览。",
          skip: false
        }
      ]);
    });

    const result = await provider.translateBatch(createRequest(context));

    expect(requests.map(({ attempt }) => attempt)).toEqual([
      "initial",
      "protected-token-repair"
    ]);
    expect(requests[1].ids).toEqual(["unit-2"]);
    expect(requests[1].contextIds).toEqual(["unit-2"]);
    expect(requests[1].body).toContain("<Widget />");
    expect(requests[1].body).not.toContain("https://example.com/private");
    expect(requests[1].body).not.toContain("`deploy()`");
    expect(requests[1].body).toContain("requiredProtectedTokens");
    expect(result.requestCount).toBe(2);
    expect(result.translations).toEqual([
      {
        id: "unit-0",
        text: "请先阅读 __VDT_PROTECTED_0_0__ 私有文档。"
      },
      {
        id: "unit-1",
        text: "运行 __VDT_PROTECTED_1_0__ 命令。"
      },
      {
        id: "unit-2",
        text: "打开 __VDT_PROTECTED_2_0__ 组件预览。"
      }
    ]);
  });

  it("repairs protected tokens that leak into the wrong translation unit", async () => {
    const requests: Array<{ attempt: string; ids: string[] }> = [];
    const context = createProtectedContext();
    const provider = createProvider(async (_input, init) => {
      const request = readChatRequest(init);
      requests.push(request);
      if (request.attempt === "initial") {
        return chatResponse([
          {
            id: "unit-0",
            text: "已翻译，但错误包含 __VDT_PROTECTED_1_0__。",
            skip: false
          },
          {
            id: "unit-1",
            text: "运行 __VDT_PROTECTED_1_0__ 命令。",
            skip: false
          },
          {
            id: "unit-2",
            text: "打开 __VDT_PROTECTED_2_0__ 组件预览。",
            skip: false
          }
        ]);
      }
      return chatResponse([
        {
          id: "unit-0",
          text: "请先阅读 __VDT_PROTECTED_0_0__ 私有文档。",
          skip: false
        }
      ]);
    });

    const result = await provider.translateBatch(createRequest(context));

    expect(requests.map(({ attempt }) => attempt)).toEqual([
      "initial",
      "protected-token-repair"
    ]);
    expect(requests[1].ids).toEqual(["unit-0"]);
    expect(result.translations[0].text).toBe(
      "请先阅读 __VDT_PROTECTED_0_0__ 私有文档。"
    );
    expect(result.translations[0].text).not.toContain("__VDT_PROTECTED_1_0__");
  });

  it("reconstructs translated Markdown when the model returns original protected values", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "original-values.md");
    await fs.writeFile(
      sourcePath,
      "Read [private docs](https://example.com/private) before running `deploy()`.\n",
      "utf8"
    );
    let requestCount = 0;
    const provider = createProvider(async (_input, init) => {
      requestCount += 1;
      const request = readChatRequest(init);
      return chatResponse([
        {
          id: request.ids[0],
          text: "请先阅读[私有文档](https://example.com/private)，然后运行 `deploy()`。",
          skip: false
        }
      ]);
    });

    const result = await translateDocument({ sourcePath, targetLanguage: "zh-CN", provider });
    const translated = await fs.readFile(result.targetPath, "utf8");

    expect(requestCount).toBe(1);
    expect(translated).toBe(
      "请先阅读[私有文档](https://example.com/private)，然后运行 `deploy()`。\n"
    );
    expect(result.warnings).toEqual([]);
  });

  it("keeps only unrepaired protected units in source while completing the document", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "protected.md");
    await fs.writeFile(
      sourcePath,
      [
        "This overview explains the deployment workflow for contributors.",
        "",
        "Read [private docs](https://example.com/private) before running `deploy()`."
      ].join("\n"),
      "utf8"
    );
    let requestCount = 0;
    const provider = createProvider(async (_input, init) => {
      requestCount += 1;
      const request = readChatRequest(init);
      const body = readChatBody(init);
      const payload = JSON.parse(body.messages[1].content) as {
        referenceDocument: { units: Array<{ id: string; sourceText: string }> };
      };
      const sourceById = new Map(
        payload.referenceDocument.units.map((unit) => [unit.id, unit.sourceText])
      );
      return chatResponse(request.ids.map((id) => ({
        id,
        text: sourceById.get(id)?.includes("VDT_PROTECTED")
          ? "请先阅读私有文档，然后运行部署命令。"
          : "本概述介绍面向贡献者的部署工作流。",
        skip: false
      })));
    });

    const result = await translateDocument({ sourcePath, targetLanguage: "zh-CN", provider });
    const translated = await fs.readFile(result.targetPath, "utf8");

    expect(result.status).toBe("translated");
    expect(requestCount).toBe(2);
    expect(translated).toContain("本概述介绍面向贡献者的部署工作流。");
    expect(translated).toContain(
      "Read [private docs](https://example.com/private) before running `deploy()`."
    );
    expect(result.warnings.join("\n")).toContain(
      "kept source text for 1 unit(s) whose protected content could not be repaired"
    );
  });

  it("writes the document with warnings when repeated source echo cannot be repaired", async () => {
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

    const result = await translateDocument({ sourcePath, targetLanguage: "zh-CN", provider });
    const translated = await fs.readFile(result.targetPath, "utf8");

    expect(requestCount).toBe(2);
    expect(result.status).toBe("translated");
    expect(translated).toContain("The roadmap explains the major implementation milestones");
    expect(result.warnings.join("\n")).toContain(
      "remained unchanged after retry; the document translation continued"
    );
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
    expect(second.metadata.provider.harnessVersion).toBe("4");
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

function createProtectedContext(): OrderedDocumentContext {
  return {
    documentId: "protected-token-test",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
    format: "markdown",
    units: [
      {
        id: "unit-0",
        order: 0,
        kind: "paragraph",
        sourceText: "Read __VDT_PROTECTED_0_0__ before continuing.",
        protectedTokens: [
          { token: "__VDT_PROTECTED_0_0__", value: "https://example.com/private" }
        ]
      },
      {
        id: "unit-1",
        order: 1,
        kind: "paragraph",
        sourceText: "Run __VDT_PROTECTED_1_0__ to deploy the project.",
        protectedTokens: [{ token: "__VDT_PROTECTED_1_0__", value: "`deploy()`" }]
      },
      {
        id: "unit-2",
        order: 2,
        kind: "paragraph",
        sourceText: "Open __VDT_PROTECTED_2_0__ to preview the component.",
        protectedTokens: [{ token: "__VDT_PROTECTED_2_0__", value: "<Widget />" }]
      }
    ]
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
