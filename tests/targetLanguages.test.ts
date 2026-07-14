import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  normalizeTargetLanguageCode,
  TARGET_LANGUAGES
} from "../src/extension/targetLanguages";
import { DeepLProvider } from "../src/core/providers/deeplProvider";
import { GoogleTranslateProvider } from "../src/core/providers/googleProvider";
import { MicrosoftTranslatorProvider } from "../src/core/providers/microsoftProvider";
import type { TranslateRequest } from "../src/core/domain/types";

const sampleRequest: TranslateRequest = {
  sourceLanguage: "auto",
  targetLanguage: "zh-CN",
  units: [
    {
      id: "unit-1",
      order: 0,
      kind: "paragraph",
      sourceText: "Hello",
      protectedTokens: []
    }
  ]
};

describe("target languages", () => {
  it("keeps settings options alphabetically sorted by display label", () => {
    const labels = TARGET_LANGUAGES.map((language) => language.label);
    const sorted = [...labels].sort((left, right) =>
      left.localeCompare(right, "en", { sensitivity: "base" })
    );

    expect(labels).toEqual(sorted);
    expect(TARGET_LANGUAGES.map((language) => language.code)).toContain("zh-CN");
  });

  it("normalizes common aliases into supported target language codes", () => {
    expect(normalizeTargetLanguageCode("zh-Hans")).toBe("zh-CN");
    expect(normalizeTargetLanguageCode("zh_hant")).toBe("zh-TW");
    expect(normalizeTargetLanguageCode("en")).toBe("en-US");
    expect(normalizeTargetLanguageCode("no")).toBe("nb");
    expect(normalizeTargetLanguageCode("made-up")).toBe("zh-CN");
  });

  it("keeps package configuration enum in sync with the settings dropdown", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      contributes: {
        configuration: {
          properties: {
            "docTranslator.defaultTargetLanguage": {
              enum: string[];
            };
            "docTranslator.cache.deleteStaleAutoTranslations": {
              default: boolean;
            };
          };
        };
      };
    };

    expect(
      packageJson.contributes.configuration.properties["docTranslator.defaultTargetLanguage"].enum
    ).toEqual(TARGET_LANGUAGES.map((language) => language.code));
    expect(
      packageJson.contributes.configuration.properties[
        "docTranslator.cache.deleteStaleAutoTranslations"
      ].default
    ).toBe(false);
  });
});

describe("traditional provider target language mapping", () => {
  it("maps Chinese variants for DeepL", async () => {
    let requestBody: unknown;
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ translations: [{ text: "你好" }] }), { status: 200 });
    };

    await new DeepLProvider({ apiKey: "key", fetch: fetchImpl }).translateBatch(sampleRequest);

    expect(requestBody).toMatchObject({ target_lang: "ZH-HANS" });
  });

  it("maps regional variants for Google", async () => {
    let requestBody: unknown;
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ data: { translations: [{ translatedText: "Hello" }] } }),
        { status: 200 }
      );
    };

    await new GoogleTranslateProvider({ apiKey: "key", fetch: fetchImpl }).translateBatch({
      ...sampleRequest,
      sourceLanguage: "en-GB",
      targetLanguage: "pt-PT"
    });

    expect(requestBody).toMatchObject({ source: "en", target: "pt" });
  });

  it("maps Chinese variants for Microsoft", async () => {
    let requestUrl = "";
    const fetchImpl: typeof fetch = async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify([{ translations: [{ text: "你好" }] }]), { status: 200 });
    };

    await new MicrosoftTranslatorProvider({ apiKey: "key", fetch: fetchImpl }).translateBatch(
      sampleRequest
    );

    expect(new URL(requestUrl).searchParams.get("to")).toBe("zh-Hans");
  });
});
