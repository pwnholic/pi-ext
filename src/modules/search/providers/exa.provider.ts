import { Exa } from 'exa-js';
import type { AppConfig } from '../../../core/config.js';
import { appError, toError } from '../../../core/errors.js';
import { err, fromPromise, type Result } from '../../../core/result.js';
import { isTimeoutError, raceAbort, withTimeout } from '../../../core/timeout.js';
import type { SearchHit, SearchQuery, SearchResponse } from '../search.types.js';
import type { SearchProvider } from './provider.js';

/** Minimal shape we consume from Exa results, decoupled from its generics. */
interface ExaResultLike {
    url: string;
    title?: string | null;
    text?: string | null;
    highlights?: string[] | null;
    publishedDate?: string | null;
    author?: string | null;
    score?: number | null;
}

/** Top-level Exa search response shape. */
interface ExaSearchResponseLike {
    results: ExaResultLike[];
}

const SNIPPET_MAX = 500;
/** Basic/free plans cap results at 10 (Exa SDK spec). */
const MAX_BASIC_RESULTS = 10;
/** Bound per-result text retrieval to keep free-tier content cost in check. */
const TEXT_BUDGET_CHARS = 1200;

/**
 * Exa-backed search provider. Uses `searchAndContents` to retrieve hits with
 * text snippets and highlights in a single call.
 *
 * Max-quality settings: `type: "auto"` (Exa picks neural vs keyword), `highlights:
 * true` (highest-quality default extracts), `text` budgeted to bound content cost,
 * `numResults` capped at the plan max.
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

        const timeoutMs = query.type?.startsWith('deep')
            ? this.config.search.timeoutMs * 3
            : this.config.search.timeoutMs;

        return fromPromise(
            (async (): Promise<SearchResponse> => {
                const signal = withTimeout(undefined, timeoutMs);
                const response = await raceAbort(
                    this.exaClient().searchAndContents(query.text, {
                    type: query.type ?? 'auto',
                    numResults,
                    text: { maxCharacters: TEXT_BUDGET_CHARS },
                    highlights: true,
                    ...(include.length > 0 ? { includeDomains: include } : {}),
                    ...(exclude.length > 0 ? { excludeDomains: exclude } : {}),
                    ...(startPublishedDate ? { startPublishedDate } : {}),
                    ...(query.category ? { category: query.category } : {}),
                    ...(query.includeText ? { includeText: [query.includeText] } : {}),
                    ...(query.excludeText ? { excludeText: [query.excludeText] } : {}),
                }) as unknown as Promise<ExaSearchResponseLike>,
                    signal,
                ) as unknown as ExaSearchResponseLike;
                const results = response.results as unknown as ExaResultLike[];
                const hits: SearchHit[] = results.map((r) => ({
                    title: r.title ?? '',
                    url: r.url,
                    snippet: bestSnippet(r),
                    ...(r.publishedDate ? { publishedAt: r.publishedDate } : {}),
                    ...(r.author ? { author: r.author } : {}),
                    ...(typeof r.score === 'number' ? { score: r.score } : {}),
                }));
                return {
                    query: query.text,
                    provider: this.name,
                    hits,
                    tookMs: Date.now() - startedAt,
                };
            })(),
            (cause) => {
                if (isTimeoutError(cause)) {
                    return appError('timeout', `Exa search timed out after ${timeoutMs}ms`, {
                        source: this.name,
                        retryable: true,
                    });
                }
                return toError(cause, this.name);
            },
        );
    }

    /** Expose the raw Exa client for reuse by the answer/contents providers. */
    exaClient(): Exa {
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
