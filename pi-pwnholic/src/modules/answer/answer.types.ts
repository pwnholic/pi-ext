export interface AnswerQuery {
    readonly query: string;
}

export interface AnswerCitation {
    readonly title: string;
    readonly url: string;
    readonly publishedDate?: string;
    readonly author?: string;
    /** Full text content of the source (when requested). */
    readonly text?: string;
}

export interface AnswerResponse {
    readonly answer: string;
    readonly citations: readonly AnswerCitation[];
    readonly tookMs: number;
}
