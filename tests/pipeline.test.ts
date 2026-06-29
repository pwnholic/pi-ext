import { describe, expect, it, vi } from 'vitest';
import { appError } from '../src/core/errors.js';
import { buildAnswerer, buildSearcher } from '../src/core/pipeline.js';
import { err, ok, type Result } from '../src/core/result.js';
import { InMemoryStore } from '../src/core/store.js';
import type { Answerer } from '../src/modules/answer/answer.service.js';
import type { AnswerResponse } from '../src/modules/answer/answer.types.js';
import type { Searcher } from '../src/modules/search/search.service.js';
import type { SearchResponse } from '../src/modules/search/search.types.js';

function fakeSearchResponse(query: string): SearchResponse {
    return {
        query,
        provider: 'fake',
        hits: [{ title: 'T', url: 'https://x.com', snippet: 'S' }],
        tookMs: 1,
    };
}

function fakeAnswerResponse(query: string): AnswerResponse {
    return {
        answer: `Answer to: ${query}`,
        citations: [{ title: 'C', url: 'https://src.com' }],
        tookMs: 1,
    };
}

// ---------------------------------------------------------------------------
// Cache key normalization
// ---------------------------------------------------------------------------

describe('cache key normalization', () => {
    it('treats queries with different whitespace as identical', async () => {
        const base: Searcher = {
            search: vi.fn(
                (q): Promise<Result<SearchResponse>> =>
                    Promise.resolve(ok(fakeSearchResponse(q.text))),
            ),
        };
        const searcher = buildSearcher(base, new InMemoryStore({ ttlMs: 60_000, maxEntries: 10 }));

        await searcher.search({ text: 'rust   async' });
        await searcher.search({ text: '  rust  async ' });

        expect(base.search).toHaveBeenCalledTimes(1);
    });

    it('treats domain order as irrelevant', async () => {
        const base: Searcher = {
            search: vi.fn(
                (q): Promise<Result<SearchResponse>> =>
                    Promise.resolve(ok(fakeSearchResponse(q.text))),
            ),
        };
        const searcher = buildSearcher(base, new InMemoryStore({ ttlMs: 60_000, maxEntries: 10 }));

        await searcher.search({ text: 'q', domains: ['a.com', 'b.com'] });
        await searcher.search({ text: 'q', domains: ['b.com', 'a.com'] });

        expect(base.search).toHaveBeenCalledTimes(1);
    });

    it('caches answer by normalized query', async () => {
        const base: Answerer = {
            answer: vi.fn(
                (q): Promise<Result<AnswerResponse>> =>
                    Promise.resolve(ok(fakeAnswerResponse(q.query))),
            ),
        };
        const answerer = buildAnswerer(base, new InMemoryStore({ ttlMs: 60_000, maxEntries: 10 }));

        await answerer.answer({ query: 'What is   Rust?' });
        await answerer.answer({ query: ' what  is rust? ' });

        expect(base.answer).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// buildAnswerer cache behavior
// ---------------------------------------------------------------------------

describe('read-through cache (buildAnswerer)', () => {
    it('serves the second identical query from cache', async () => {
        const base: Answerer = {
            answer: vi.fn(
                (q): Promise<Result<AnswerResponse>> =>
                    Promise.resolve(ok(fakeAnswerResponse(q.query))),
            ),
        };
        const answerer = buildAnswerer(base, new InMemoryStore({ ttlMs: 60_000, maxEntries: 10 }));

        const first = await answerer.answer({ query: 'hello' });
        const second = await answerer.answer({ query: 'hello' });

        expect(first.ok && second.ok).toBe(true);
        expect(base.answer).toHaveBeenCalledTimes(1);
    });

    it('does not cache failures', async () => {
        const base: Answerer = {
            answer: vi.fn(
                (): Promise<Result<AnswerResponse>> =>
                    Promise.resolve(err(appError('network', 'x', { retryable: true }))),
            ),
        };
        const answerer = buildAnswerer(base, new InMemoryStore({ ttlMs: 60_000, maxEntries: 10 }));

        await answerer.answer({ query: 'q' });
        await answerer.answer({ query: 'q' });

        expect(base.answer).toHaveBeenCalledTimes(2);
    });

    it('passes through when no cache is configured', async () => {
        const base: Answerer = {
            answer: vi.fn(
                (q): Promise<Result<AnswerResponse>> =>
                    Promise.resolve(ok(fakeAnswerResponse(q.query))),
            ),
        };
        const answerer = buildAnswerer(base);

        await answerer.answer({ query: 'a' });
        await answerer.answer({ query: 'a' });

        expect(base.answer).toHaveBeenCalledTimes(2);
    });
});
