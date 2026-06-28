export interface FetchRequest {
    readonly url: string;
    /** Override the default impersonation target for this request. */
    readonly impersonate?: string;
}

export type ContentKind = 'html' | 'markdown' | 'text' | 'json' | 'pdf' | 'binary';

export interface FetchedDocument {
    readonly url: string;
    readonly finalUrl: string;
    readonly status: number;
    readonly title: string;
    readonly kind: ContentKind;
    /** Readable content, extracted/converted to markdown for HTML pages. */
    readonly content: string;
    readonly tookMs: number;
}
