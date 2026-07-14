import { describe, expect, it } from "vitest";
import { createOutputNames, formatTimestampUtc } from "../src/core/domain/naming";

describe("output naming", () => {
  it("creates stable auto translation names", () => {
    const timestamp = formatTimestampUtc(new Date("2026-07-13T15:02:45Z"));
    const names = createOutputNames({
      sourcePath: "guide.md",
      targetLanguage: "zh-CN",
      timestamp,
      sourceHash: "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
      translatedHash: "a3f9d9e1f3c0a50e7fefadbd1813f25b1a8ab1ef706ea45c9fa94a9281aa0def"
    });

    expect(timestamp).toBe("20260713T150245Z");
    expect(names.translatedFileName).toBe("guide.auto.zh-CN.20260713T150245Z.md");
    expect(names.metadataFileName).toBe(
      "guide.auto.zh-CN.20260713T150245Z.src-2c26b46b.dst-a3f9d9e1.meta.json"
    );
  });
});
