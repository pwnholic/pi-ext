export type SummaryStyle = 'sentences' | 'bullets';

export interface SummarizeOptions {
    /** Target length for `sentences` style (default 3) or bullet count for `bullets`. */
    readonly maxSentences?: number;
    readonly style?: SummaryStyle;
    /** Override the LLM model id. */
    readonly model?: string;
}

export interface SummaryResult {
    readonly summary: string;
    readonly style: SummaryStyle;
    /** Number of map-reduce passes (1 = single shot, >1 = chunked long input). */
    readonly passes: number;
    readonly inputChars: number;
    readonly tookMs: number;
}
