import type { Answerer } from '../modules/answer/answer.service.js';
import type { AnswerQuery } from '../modules/answer/answer.types.js';
import type { Fetcher } from '../modules/fetch/fetch.service.js';
import type { FetchRequest } from '../modules/fetch/fetch.types.js';
import type { Searcher } from '../modules/search/search.service.js';
import type { SearchQuery } from '../modules/search/search.types.js';
import { ok, type Result } from './result.js';
import type { CacheStore } from './store.js';

/**
 * Composition pipeline: wraps base services with a read-through cache
 * decorator. Replaces the former event bus + telemetry layer with a single,
 * traceable function composition.
 */

/** Read-through cache: serve a fresh hit, otherwise run `op` and store on success. */
async function readThrough<T>(
    store: CacheStore | undefined,
    key: string,
    op: () => Promise<Result<T>>,
): Promise<Result<T>> {
    if (store) {
        const hit = store.get<T>(key);
        if (hit !== undefined) return ok(hit);
    }
    const result = await op();
    if (store && result.ok) store.set(key, result.value);
    return result;
}

export function buildSearcher(base: Searcher, cache?: CacheStore): Searcher {
    return {
        search: (query, signal) =>
            readThrough(cache, searchKey(query), () => base.search(query, signal)),
    };
}

export function buildFetcher(base: Fetcher, cache?: CacheStore): Fetcher {
    return {
        fetch: (request, signal) =>
            readThrough(cache, fetchKey(request), () => base.fetch(request, signal)),
    };
}

export function buildAnswerer(base: Answerer, cache?: CacheStore): Answerer {
    return {
        answer: (query, signal) =>
            readThrough(cache, answerKey(query), () => base.answer(query, signal)),
    };
}

function searchKey(q: SearchQuery): string {
    const domains = (q.domains ?? []).slice().sort().join(',');
    const text = q.text.trim().toLowerCase().replace(/\s+/g, ' ');
    return `search:${q.type ?? 'auto'}:${q.numResults ?? 'd'}:${q.recency ?? ''}:${q.category ?? ''}:${domains}:${q.includeText ?? ''}:${q.excludeText ?? ''}:${text}`;
}

function fetchKey(r: FetchRequest): string {
    return `fetch:${r.impersonate ?? 'd'}:${r.url}`;
}

function answerKey(q: AnswerQuery): string {
    return `answer:${q.query.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}
