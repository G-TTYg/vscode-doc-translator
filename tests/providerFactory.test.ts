import { describe, expect, it } from "vitest";
import { createProvider } from "../src/core/providers/providerFactory";

describe("provider factory", () => {
  it("creates all configured provider families", () => {
    expect(
      createProvider({
        providerId: "openai-compatible",
        openAiCompatible: {
          endpoint: "https://example.test/v1",
          apiKey: "key",
          model: "model",
          maxContextTokens: 5000,
          maxOutputTokens: 1024
        }
      }).capabilities.maxContextTokens
    ).toBe(5000);
    expect(createProvider({ providerId: "deepl", deepl: { apiKey: "key" } }).id).toBe("deepl");
    expect(createProvider({ providerId: "google", google: { apiKey: "key" } }).id).toBe(
      "google"
    );
    expect(
      createProvider({ providerId: "microsoft", microsoft: { apiKey: "key", region: "eastus" } })
        .id
    ).toBe("microsoft");
  });
});
