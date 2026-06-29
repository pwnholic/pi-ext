export type SearchType =
    | 'auto'
    | 'fast'
    | 'instant'
    | 'deep-lite'
    | 'deep'
    | 'deep-reasoning';

export type SearchCategory =
    | 'company'
    | 'research paper'
    | 'news'
    | 'personal site'
    | 'financial report'
    | 'people';

export interface SearchQuery {
    readonly text: string;
    readonly numResults?: number;
    readonly type?: SearchType;
    readonly category?: SearchCategory;
    readonly recency?: 'day' | 'week' | 'month' | 'year';
    /** Include domains, or exclude with a leading "-". */
    readonly domains?: readonly string[];
    /** String that must be present in webpage text (max 1 string, up to 5 words). */
    readonly includeText?: string;
    /** String that must not be present in webpage text (max 1 string, up to 5 words). */
    readonly excludeText?: string;
}

export interface SearchHit {
    readonly title: string;
    readonly url: string;
    readonly snippet: string;
    readonly publishedAt?: string;
    readonly author?: string;
    readonly score?: number;
}

export interface SearchResponse {
    readonly query: string;
    readonly provider: string;
    readonly hits: readonly SearchHit[];
    readonly tookMs: number;
}
