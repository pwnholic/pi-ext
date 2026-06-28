export interface ExtractedLink {
    readonly text: string;
    readonly href: string;
}

export interface ExtractedImage {
    readonly alt: string;
    readonly src: string;
}

export interface ExtractedCodeBlock {
    readonly language: string | undefined;
    readonly code: string;
}

export interface ExtractedAssets {
    links: ExtractedLink[];
    images: ExtractedImage[];
    codeBlocks: ExtractedCodeBlock[];
}

export interface ExtractionOptions {
    /** Only keep <article>/<main>/[role=main] when present. */
    readonly onlyMainContent?: boolean;
    /** CSS selectors whose subtrees are removed before extraction. */
    readonly excludeSelectors?: readonly string[];
    /** CSS selectors to extract verbatim, skipping the scoring path. */
    readonly includeSelectors?: readonly string[];
}

export interface ExtractionResult {
    readonly markdown: string;
    readonly plainText: string;
    readonly assets: ExtractedAssets;
}

export const MAX_DOM_DEPTH = 200;
