import path from "node:path";
import type { DocumentFormatAdapter, SourceFileInfo } from "../domain/types";
import { HtmlXmlAdapter } from "./htmlXmlAdapter";
import { MarkdownAdapter } from "./markdownAdapter";
import { MdxAdapter } from "./mdxAdapter";
import { PlainTextAdapter } from "./plainTextAdapter";

export function createDefaultFormatAdapters(): readonly DocumentFormatAdapter[] {
  return [new MdxAdapter(), new MarkdownAdapter(), new HtmlXmlAdapter(), new PlainTextAdapter()];
}

export function selectFormatAdapter(
  sourcePath: string,
  adapters: readonly DocumentFormatAdapter[] = createDefaultFormatAdapters()
): DocumentFormatAdapter {
  const info: SourceFileInfo = {
    sourcePath,
    extension: path.extname(sourcePath).toLowerCase()
  };
  return adapters.find((adapter) => adapter.canHandle(info)) ?? new PlainTextAdapter();
}
