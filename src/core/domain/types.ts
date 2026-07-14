export type TranslationRequestPackaging = "segmented-units" | "ordered-json-context";

export type OutputDirectoryMode = "same-dir" | "hidden-cache";

export type TranslationUnitKind =
  | "paragraph"
  | "heading"
  | "listItem"
  | "tableCell"
  | "text";

export interface ProtectedToken {
  readonly token: string;
  readonly value: string;
}

export interface TranslationUnit {
  readonly id: string;
  readonly order: number;
  readonly kind: TranslationUnitKind;
  readonly sourceText: string;
  readonly protectedTokens: readonly ProtectedToken[];
}

export interface OrderedContextUnit extends TranslationUnit {
  readonly nearbyContext?: string;
}

export interface OrderedDocumentContext {
  readonly documentId: string;
  readonly sourceLanguage: string | "auto";
  readonly targetLanguage: string;
  readonly format: string;
  readonly units: readonly OrderedContextUnit[];
}

export type TranslationMap = Map<string, string>;

export interface ParseInput {
  readonly sourcePath: string;
  readonly text: string;
}

export interface ParsedDocument {
  readonly format: string;
  readonly sourcePath: string;
  readonly text: string;
  readonly lineEnding: "lf" | "crlf" | "mixed";
}

export interface ReconstructedDocument {
  readonly text: string;
  readonly warnings: readonly string[];
}

export interface SourceFileInfo {
  readonly sourcePath: string;
  readonly extension: string;
}

export interface ValidationIssue {
  readonly unitId?: string;
  readonly severity: "warning" | "error";
  readonly message: string;
}

export interface DocumentFormatAdapter<TDocument extends ParsedDocument = ParsedDocument> {
  readonly id: string;
  readonly version: string;
  canHandle(file: SourceFileInfo): boolean;
  parse(input: ParseInput): Promise<TDocument>;
  extractUnits(document: TDocument): Promise<readonly TranslationUnit[]>;
  buildOrderedJsonContext?(
    document: TDocument,
    units: readonly TranslationUnit[],
    request: {
      readonly documentId: string;
      readonly sourceLanguage: string | "auto";
      readonly targetLanguage: string;
    }
  ): Promise<OrderedDocumentContext>;
  reconstruct(document: TDocument, translations: TranslationMap): Promise<ReconstructedDocument>;
  validate?(document: TDocument, translations: TranslationMap): Promise<readonly ValidationIssue[]>;
}

export interface ProviderCapabilities {
  readonly requestPackaging: TranslationRequestPackaging;
  readonly maxBatchCharacters?: number;
  readonly maxContextCharacters?: number;
  readonly maxContextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly supportsStructuredJsonOutput: boolean;
  readonly supportsGlossary?: boolean;
}

export interface TranslateRequest {
  readonly sourceLanguage: string | "auto";
  readonly targetLanguage: string;
  readonly units: readonly TranslationUnit[];
  readonly orderedContext?: OrderedDocumentContext;
}

export interface TranslatedUnit {
  readonly id: string;
  readonly text: string;
}

export interface TranslateResult {
  readonly translations: readonly TranslatedUnit[];
  readonly warnings: readonly string[];
  readonly requestCount: number;
}

export interface TranslationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  translateBatch(request: TranslateRequest): Promise<TranslateResult>;
}

export interface TranslationMetadata {
  readonly schemaVersion: 1;
  readonly translationId: string;
  readonly status: "complete" | "partial";
  readonly createdAt: string;
  readonly source: {
    readonly relativePath: string;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly mtimeUtc: string;
    readonly language: string | "auto";
  };
  readonly target: {
    readonly language: string;
    readonly relativePath: string;
    readonly directoryMode?: OutputDirectoryMode;
    readonly sha256: string;
    readonly sizeBytes: number;
  };
  readonly format: {
    readonly adapter: string;
    readonly adapterVersion: string;
    readonly lineEnding: ParsedDocument["lineEnding"];
    readonly encoding: "utf8";
  };
  readonly provider: {
    readonly id: string;
    readonly modelOrApiVersion?: string;
    readonly endpointLabel?: string;
    readonly requestPackaging: TranslationRequestPackaging;
    readonly maxContextCharacters?: number;
    readonly maxContextTokens?: number;
    readonly maxOutputTokens?: number;
  };
  readonly profile: {
    readonly name: string;
    readonly hash: string;
  };
  readonly pipeline: {
    readonly coreVersion: string;
    readonly segmenterVersion: string;
    readonly segmentCount: number;
    readonly translatedSegmentCount: number;
    readonly requestCount: number;
    readonly markdownHeaderInserted: boolean;
    readonly warnings: readonly string[];
  };
}

export interface TranslateDocumentOptions {
  readonly sourcePath: string;
  readonly targetLanguage: string;
  readonly sourceLanguage?: string | "auto";
  readonly provider: TranslationProvider;
  readonly force?: boolean;
  readonly now?: Date;
  readonly cacheDirectoryName?: string;
  readonly outputDirectoryMode?: OutputDirectoryMode;
  readonly profileName?: string;
  readonly insertMarkdownHeader?: boolean;
  readonly termLocks?: readonly string[];
}

export interface TranslateDocumentResult {
  readonly status: "translated" | "cached";
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly metadataPath: string;
  readonly metadata: TranslationMetadata;
  readonly warnings: readonly string[];
}
