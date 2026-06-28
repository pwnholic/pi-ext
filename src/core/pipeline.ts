import type { Fetcher } from '../modules/fetch/fetch.service.js';
import type { FetchRequest } from '../modules/fetch/fetch.types.js';
import type { Searcher } from '../modules/search/search.service.js';
import type { SearchQuery } from '../modules/search/search.types.js';
import type { Summarizer } from '../modules/summarize/summarize.service.js';
import { type Instrumentation, instrument, readThrough } from './instrument.js';
import type { CacheStore } from './store.js';

/**
 * Composition pipeline: wraps base services with cross-cutting decorators
 * (read-through cache, then telemetry) in explicit, ordered layers. Replaces
 * the event bus + subscribers with traceable function composition.
 */

export function buildSearcher(base: Searcher, inst: Instrumentation, cache?: CacheStore): Searcher {
    return {
        search: (query, signal) =>
            instrument(
                inst,
                'search',
                query.text,
                (r) => `${r.hits.length} hits via ${r.provider}`,
                () => readThrough(cache, searchKey(query), () => base.search(query, signal)),
            ),
    };
}

export function buildFetcher(base: Fetcher, inst: Instrumentation, cache?: CacheStore): Fetcher {
    return {
        fetch: (request, signal) =>
            instrument(
                inst,
                'fetch',
                request.url,
                (d) => `${d.status} ${d.kind}`,
                () => readThrough(cache, fetchKey(request), () => base.fetch(request, signal)),
            ),
    };
}

export function buildSummarizer(base: Summarizer, inst: Instrumentation): Summarizer {
    return {
        isAvailable: () => base.isAvailable(),
        summarize: (content, options, signal) =>
            instrument(
                inst,
                'summarize',
                `${content.length} chars`,
                (s) => `${s.passes} pass(es)`,
                () => base.summarize(content, options, signal),
            ),
    };
}

function searchKey(q: SearchQuery): string {
    const domains = (q.domains ?? []).join(',');
    return `search:${q.numResults ?? 'd'}:${q.recency ?? ''}:${domains}:${q.text.trim().toLowerCase()}`;
}

function fetchKey(r: FetchRequest): string {
    return `fetch:${r.impersonate ?? 'd'}:${r.url}`;
}
