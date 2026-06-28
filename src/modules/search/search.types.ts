export interface SearchQuery {
    readonly text: string;
    readonly numResults?: number;
    readonly recency?: 'day' | 'week' | 'month' | 'year';
    /** Include domains, or exclude with a leading "-". */
    readonly domains?: readonly string[];
}

export interface SearchHit {
    readonly title: string;
    readonly url: string;
    readonly snippet: string;
    readonly publishedAt?: string;
    readonly score?: number;
}

export interface SearchResponse {
    readonly query: string;
    readonly provider: string;
    readonly hits: readonly SearchHit[];
    /** Optional synthesized answer when the provider supports it. */
    readonly answer?: string;
    readonly tookMs: number;
}
