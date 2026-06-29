import { describe, expect, it } from 'vitest';
import { ok, type Result } from '../src/core/result.js';
import { createWebSearchTool } from '../src/extension/tools/web-search.tool.js';
import type { Searcher } from '../src/modules/search/search.service.js';
import type { SearchHit, SearchResponse } from '../src/modules/search/search.types.js';

function hit(partial: Partial<SearchHit> & { url: string }): SearchHit {
    return { title: 'T', snippet: 's', ...partial };
}

function searcherReturning(byQuery: Record<string, SearchHit[]>): Searcher {
    return {
        search: (q): Promise<Result<SearchResponse>> =>
            Promise.resolve(
                ok({ query: q.text, provider: 'exa', hits: byQuery[q.text] ?? [], tookMs: 1 }),
            ),
    };
}

const signal = new AbortController().signal;

describe('web_search tool formatting', () => {
    it('errors when neither query nor queries is provided', async () => {
        const tool = createWebSearchTool(searcherReturning({}));
        const r = await tool.execute({}, signal);
        expect(r.content[0]?.text).toContain('provide `query` or `queries`');
    });

    it('renders a single query as one clean list with no duplication', async () => {
        const tool = createWebSearchTool(
            searcherReturning({
                rust: [
                    hit({ url: 'https://a.com', title: 'A', snippet: 'about a' }),
                    hit({ url: 'https://b.com', title: 'B', snippet: 'about b' }),
                ],
            }),
        );
        const r = await tool.execute({ query: 'rust' }, signal);
        const text = r.content[0]?.text ?? '';

        // Each URL appears exactly once (no per-query + merged duplication).
        expect(text.split('https://a.com').length - 1).toBe(1);
        expect(text.split('https://b.com').length - 1).toBe(1);
        expect(text).not.toContain('Merged Results');
        expect(r.details?.uniqueUrls).toBe(2);
    });

    it('deduplicates across multiple queries into a single list', async () => {
        const shared = hit({
            url: 'https://shared.com',
            title: 'Shared',
            snippet: 'shared',
            score: 0.5,
        });
        const tool = createWebSearchTool(
            searcherReturning({
                q1: [shared, hit({ url: 'https://only1.com', title: 'One' })],
                q2: [
                    { ...shared, score: 0.9 }, // higher score — should win
                    hit({ url: 'https://only2.com', title: 'Two' }),
                ],
            }),
        );
        const r = await tool.execute({ queries: ['q1', 'q2'] }, signal);
        const text = r.content[0]?.text ?? '';

        // Shared URL appears exactly once despite being in both queries.
        expect(text.split('https://shared.com').length - 1).toBe(1);
        expect(text).toContain('https://only1.com');
        expect(text).toContain('https://only2.com');
        expect(r.details?.uniqueUrls).toBe(3);
        // Header lists both queries.
        expect(text).toContain('2 queries');
    });

    it('strips a leading copy of the title from the snippet', async () => {
        const tool = createWebSearchTool(
            searcherReturning({
                q: [
                    hit({
                        url: 'https://x.com',
                        title: 'My Title',
                        snippet: 'My Title — the actual content',
                    }),
                ],
            }),
        );
        const r = await tool.execute({ query: 'q' }, signal);
        const text = r.content[0]?.text ?? '';
        // The snippet line should not start by repeating the title.
        expect(text).toContain('the actual content');
        expect(text).not.toContain('My Title — the actual content');
    });

    it('collapses whitespace and caps long snippets', async () => {
        const longSnippet = `${'word '.repeat(100)}`;
        const tool = createWebSearchTool(
            searcherReturning({
                q: [hit({ url: 'https://x.com', title: 'T', snippet: longSnippet })],
            }),
        );
        const r = await tool.execute({ query: 'q' }, signal);
        const text = r.content[0]?.text ?? '';
        // No runs of multiple spaces, and the snippet is capped with an ellipsis.
        const snippetLine = text.split('\n').find((l) => l.includes('word'));
        expect(snippetLine).toBeDefined();
        // No double spaces within the snippet content (ignore the 3-space indent).
        expect(snippetLine?.trim()).not.toMatch(/ {2,}/);
        expect(text).toContain('\u2026');
    });

    it('reports per-query failures without aborting the whole result', async () => {
        const service: Searcher = {
            search: (q): Promise<Result<SearchResponse>> =>
                q.text === 'bad'
                    ? Promise.resolve({
                          ok: false,
                          error: { kind: 'network', message: 'boom', retryable: true },
                      })
                    : Promise.resolve(
                          ok({
                              query: q.text,
                              provider: 'exa',
                              hits: [hit({ url: 'https://good.com', title: 'Good' })],
                              tookMs: 1,
                          }),
                      ),
        };
        const tool = createWebSearchTool(service);
        const r = await tool.execute({ queries: ['good', 'bad'] }, signal);
        const text = r.content[0]?.text ?? '';
        expect(text).toContain('https://good.com');
        expect(text).toContain('Query "bad" failed: boom');
    });
});
