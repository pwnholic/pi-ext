import { Exa } from 'exa-js';
import type { AppConfig } from '../../../core/config.js';
import { appError, toError } from '../../../core/errors.js';
import { err, fromPromise, type Result } from '../../../core/result.js';
import type { SearchHit, SearchQuery, SearchResponse } from '../search.types.js';
import type { SearchProvider } from './provider.js';

/** Minimal shape we consume from Exa results, decoupled from its generics. */
interface ExaResultLike {
    url: string;
    title?: string | null;
    text?: string | null;
    highlights?: string[] | null;
    publishedDate?: string | null;
    score?: number | null;
}

const SNIPPET_MAX = 500;
/** Basic/free plans cap results at 10 (Exa SDK spec). */
const MAX_BASIC_RESULTS = 10;
/** Bound per-result text retrieval to keep free-tier content cost in check. */
const TEXT_BUDGET_CHARS = 1200;

/**
 * Exa-backed search provider. Uses `searchAndContents` to retrieve hits with
 * text snippets in a single call.
 */
export class ExaSearchProvider implements SearchProvider {
    readonly name = 'exa';
    private client: Exa | undefined;

    constructor(private readonly config: AppConfig) {}

    isAvailable(): boolean {
        return Boolean(this.config.search.exaApiKey);
    }

    async search(query: SearchQuery, signal?: AbortSignal): Promise<Result<SearchResponse>> {
        if (!this.isAvailable()) {
            return err(
                appError('provider_unavailable', 'Exa API key not configured', {
                    source: this.name,
                }),
            );
        }
        if (signal?.aborted) {
            return err(appError('aborted', 'Search aborted', { source: this.name }));
        }

        const startedAt = Date.now();
        const { include, exclude } = partitionDomains(query.domains);
        const startPublishedDate = recencyToIso(query.recency);

        const requested = query.numResults ?? this.config.search.defaultNumResults;
        const numResults = Math.min(Math.max(requested, 1), MAX_BASIC_RESULTS);

        return fromPromise(
            (async (): Promise<SearchResponse> => {
                // Maximum-quality settings within the free/basic plan:
                // - type 'auto' lets Exa pick neural vs keyword (deep* variants cost more)
                // - useAutoprompt improves query understanding for neural retrieval
                // - highlights surface the most relevant extracts (best snippet quality)
                // - text budgeted to bound content cost; numResults capped at the plan max
                const response = await this.exa().searchAndContents(query.text, {
                    type: 'auto',
                    useAutoprompt: true,
                    numResults,
                    text: { maxCharacters: TEXT_BUDGET_CHARS },
                    highlights: true,
                    ...(include.length > 0 ? { includeDomains: include } : {}),
                    ...(exclude.length > 0 ? { excludeDomains: exclude } : {}),
                    ...(startPublishedDate ? { startPublishedDate } : {}),
                });
                const results = response.results as unknown as ExaResultLike[];
                const hits: SearchHit[] = results.map((r) => ({
                    title: r.title ?? '',
                    url: r.url,
                    snippet: bestSnippet(r),
                    ...(r.publishedDate ? { publishedAt: r.publishedDate } : {}),
                    ...(typeof r.score === 'number' ? { score: r.score } : {}),
                }));
                return {
                    query: query.text,
                    provider: this.name,
                    hits,
                    tookMs: Date.now() - startedAt,
                };
            })(),
            (cause) => toError(cause, this.name),
        );
    }

    private exa(): Exa {
        if (!this.client) {
            const apiKey = this.config.search.exaApiKey;
            // Guarded by isAvailable() before any call path reaches here.
            if (!apiKey) throw new Error('Exa API key not configured');
            this.client = new Exa(apiKey);
        }
        return this.client;
    }
}

/** Prefer Exa highlights (most relevant extracts) over raw text for the snippet. */
function bestSnippet(r: ExaResultLike): string {
    const highlights = (r.highlights ?? []).map((h) => h.trim()).filter(Boolean);
    const source = highlights.length > 0 ? highlights.join(' \u2026 ') : (r.text ?? '');
    return source.trim().slice(0, SNIPPET_MAX);
}

function partitionDomains(domains?: readonly string[]): {
    include: string[];
    exclude: string[];
} {
    const include: string[] = [];
    const exclude: string[] = [];
    for (const d of domains ?? []) {
        if (d.startsWith('-')) exclude.push(d.slice(1));
        else include.push(d);
    }
    return { include, exclude };
}

function recencyToIso(recency?: SearchQuery['recency']): string | undefined {
    if (!recency) return undefined;
    const now = Date.now();
    const day = 86_400_000;
    const offset = { day: day, week: 7 * day, month: 30 * day, year: 365 * day }[recency];
    return new Date(now - offset).toISOString();
}
