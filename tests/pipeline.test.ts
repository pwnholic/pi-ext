import { describe, expect, it, vi } from 'vitest';
import { ActivityMonitor } from '../src/core/activity-monitor.js';
import { appError } from '../src/core/errors.js';
import { buildSearcher } from '../src/core/pipeline.js';
import { err, ok, type Result } from '../src/core/result.js';
import { InMemoryStore } from '../src/core/store.js';
import type { Searcher } from '../src/modules/search/search.service.js';
import type { SearchResponse } from '../src/modules/search/search.types.js';

function fakeResponse(query: string): SearchResponse {
    return { query, provider: 'fake', hits: [], tookMs: 1 };
}

function inst() {
    return { monitor: new ActivityMonitor() };
}

describe('read-through cache (buildSearcher)', () => {
    it('serves the second identical query from cache without re-hitting the provider', async () => {
        const base: Searcher = {
            search: vi.fn(
                (q): Promise<Result<SearchResponse>> => Promise.resolve(ok(fakeResponse(q.text))),
            ),
        };
        const cache = new InMemoryStore({ ttlMs: 60_000, maxEntries: 10 });
        const searcher = buildSearcher(base, inst(), cache);

        const first = await searcher.search({ text: 'hello' });
        const second = await searcher.search({ text: 'hello' });

        expect(first.ok && second.ok).toBe(true);
        expect(base.search).toHaveBeenCalledTimes(1); // second call hit cache
    });

    it('does not cache failures', async () => {
        const base: Searcher = {
            search: vi.fn(
                (): Promise<Result<SearchResponse>> =>
                    Promise.resolve(err(appError('network', 'x', { retryable: true }))),
            ),
        };
        const searcher = buildSearcher(
            base,
            inst(),
            new InMemoryStore({ ttlMs: 60_000, maxEntries: 10 }),
        );
        await searcher.search({ text: 'q' });
        await searcher.search({ text: 'q' });
        expect(base.search).toHaveBeenCalledTimes(2);
    });
});

describe('instrumentation feeds the activity monitor', () => {
    it('records a running entry that ends ok', async () => {
        const monitor = new ActivityMonitor();
        const snapshots: number[] = [];
        monitor.onUpdate((entries) => snapshots.push(entries.length));
        const base: Searcher = { search: (q) => Promise.resolve(ok(fakeResponse(q.text))) };

        await buildSearcher(base, { monitor }).search({ text: 'q' });

        const [entry] = monitor.snapshot();
        expect(entry?.kind).toBe('search');
        expect(entry?.status).toBe('ok');
        expect(snapshots.length).toBeGreaterThanOrEqual(2); // start + end notifications
    });
});

describe('InMemoryStore', () => {
    it('expires entries after the TTL', () => {
        const store = new InMemoryStore({ ttlMs: 5, maxEntries: 10 });
        store.set('k', 'v');
        expect(store.get('k')).toBe('v');
        vi.useFakeTimers();
        try {
            vi.setSystemTime(Date.now() + 10);
            expect(store.get('k')).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('evicts the least-recently-used entry past the cap', () => {
        const store = new InMemoryStore({ ttlMs: 60_000, maxEntries: 2 });
        store.set('a', 1);
        store.set('b', 2);
        store.get('a'); // touch a -> b is now LRU
        store.set('c', 3); // evicts b
        expect(store.get('a')).toBe(1);
        expect(store.get('b')).toBeUndefined();
        expect(store.get('c')).toBe(3);
    });
});
