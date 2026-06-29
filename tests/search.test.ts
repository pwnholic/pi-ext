import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import { appError } from '../src/core/errors.js';
import { err, ok } from '../src/core/result.js';
import { cleanHighlight, ExaSearchProvider } from '../src/modules/search/providers/exa.provider.js';
import type { SearchProvider } from '../src/modules/search/providers/provider.js';
import { SearchService } from '../src/modules/search/search.service.js';
import type { SearchResponse } from '../src/modules/search/search.types.js';

const config = { ...DEFAULT_CONFIG, search: { ...DEFAULT_CONFIG.search, exaApiKey: 'test-key' } };

function fakeExaResponse(): unknown {
    return {
        results: [
            {
                url: 'https://example.com/article',
                title: 'Test Article',
                text: 'Some text content here',
                highlights: ['key highlight from the page'],
                publishedDate: '2024-01-15T00:00:00.000Z',
                author: 'Jane Doe',
                score: 0.95,
            },
        ],
    };
}

describe('ExaSearchProvider', () => {
    it('returns provider_unavailable without an API key', async () => {
        const provider = new ExaSearchProvider({ ...DEFAULT_CONFIG });
        const r = await provider.search({ text: 'test' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.kind).toBe('provider_unavailable');
    });

    it('returns search results with highlights, author, and score', async () => {
        const provider = new ExaSearchProvider(config);
        const fakeExa = {
            searchAndContents: vi.fn().mockResolvedValue(fakeExaResponse()),
        };
        (provider as unknown as { exaClient: () => unknown }).exaClient = () => fakeExa;

        const r = await provider.search({ text: 'test query' });

        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.hits).toHaveLength(1);
            expect(r.value.hits[0]?.title).toBe('Test Article');
            expect(r.value.hits[0]?.url).toBe('https://example.com/article');
            expect(r.value.hits[0]?.snippet).toContain('key highlight');
            expect(r.value.hits[0]?.author).toBe('Jane Doe');
            expect(r.value.hits[0]?.score).toBe(0.95);
            expect(r.value.hits[0]?.publishedAt).toBe('2024-01-15T00:00:00.000Z');
        }
    });

    it('passes category, type, includeText, and excludeText to Exa', async () => {
        const provider = new ExaSearchProvider(config);
        const fakeExa = {
            searchAndContents: vi.fn().mockResolvedValue({ results: [] }),
        };
        (provider as unknown as { exaClient: () => unknown }).exaClient = () => fakeExa;

        await provider.search({
            text: 'AI startups',
            type: 'deep',
            category: 'company',
            includeText: 'funding',
            excludeText: 'acquisition',
            numResults: 5,
            recency: 'month',
            domains: ['techcrunch.com', '-medium.com'],
        });

        const call = fakeExa.searchAndContents.mock.calls[0];
        const query = call?.[0];
        const options = call?.[1] as Record<string, unknown>;
        expect(query).toBe('AI startups');
        expect(options.type).toBe('deep');
        expect(options.numResults).toBe(5);
        expect(options.highlights).toBe(true);
        expect(options.category).toBe('company');
        expect(options.includeText).toEqual(['funding']);
        expect(options.excludeText).toEqual(['acquisition']);
        expect(options.includeDomains).toEqual(['techcrunch.com']);
        expect(options.excludeDomains).toEqual(['medium.com']);
        expect(options.startPublishedDate).toBeDefined();
    });

    it('does not pass useAutoprompt (deprecated)', async () => {
        const provider = new ExaSearchProvider(config);
        const fakeExa = {
            searchAndContents: vi.fn().mockResolvedValue({ results: [] }),
        };
        (provider as unknown as { exaClient: () => unknown }).exaClient = () => fakeExa;

        await provider.search({ text: 'test' });

        const options = fakeExa.searchAndContents.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(options.useAutoprompt).toBeUndefined();
    });

    it('caps numResults at 10', async () => {
        const provider = new ExaSearchProvider(config);
        const fakeExa = {
            searchAndContents: vi.fn().mockResolvedValue({ results: [] }),
        };
        (provider as unknown as { exaClient: () => unknown }).exaClient = () => fakeExa;

        await provider.search({ text: 'test', numResults: 50 });

        const options = fakeExa.searchAndContents.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(options.numResults).toBe(10);
    });

    it('maps unknown errors to AppError', async () => {
        const provider = new ExaSearchProvider(config);
        const fakeExa = {
            searchAndContents: vi.fn().mockRejectedValue(new Error('rate limited')),
        };
        (provider as unknown as { exaClient: () => unknown }).exaClient = () => fakeExa;

        const r = await provider.search({ text: 'test' });
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.error.message).toContain('rate limited');
        }
    });

    it('falls back to text when no highlights', async () => {
        const provider = new ExaSearchProvider(config);
        const fakeExa = {
            searchAndContents: vi.fn().mockResolvedValue({
                results: [
                    {
                        url: 'https://x.com',
                        title: 'No Highlights',
                        text: 'This is the raw text fallback.',
                        highlights: null,
                    },
                ],
            }),
        };
        (provider as unknown as { exaClient: () => unknown }).exaClient = () => fakeExa;

        const r = await provider.search({ text: 'test' });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.hits[0]?.snippet).toContain('raw text fallback');
        }
    });
});

describe('SearchService', () => {
    it('returns no_provider when no providers are available', async () => {
        const service = new SearchService({ providers: [] });
        const r = await service.search({ text: 'test' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.kind).toBe('no_provider');
    });

    it('falls back to next provider on retryable error', async () => {
        const failing: SearchProvider = {
            name: 'failing',
            isAvailable: () => true,
            search: vi
                .fn()
                .mockResolvedValue(err(appError('network', 'down', { retryable: true }))),
        };
        const working: SearchProvider = {
            name: 'working',
            isAvailable: () => true,
            search: vi.fn().mockResolvedValue(
                ok({
                    query: 'test',
                    provider: 'working',
                    hits: [],
                    tookMs: 1,
                } satisfies SearchResponse),
            ),
        };
        const service = new SearchService({ providers: [failing, working] });
        const r = await service.search({ text: 'test' });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.provider).toBe('working');
    });

    it('stops on non-retryable error', async () => {
        const failing: SearchProvider = {
            name: 'failing',
            isAvailable: () => true,
            search: async () => err(appError('invalid_input', 'bad query', { retryable: false })),
        };
        const workingSearch = vi.fn();
        const working: SearchProvider = {
            name: 'working',
            isAvailable: () => true,
            search: workingSearch,
        };
        const service = new SearchService({ providers: [failing, working] });
        const r = await service.search({ text: 'test' });
        expect(r.ok).toBe(false);
        expect(workingSearch).not.toHaveBeenCalled();
    });
});

describe('SearchService with retry', () => {
    it('retries a provider on transient failures before advancing', async () => {
        const searchFn = vi
            .fn()
            .mockResolvedValueOnce(err(appError('network', 'down', { retryable: true })))
            .mockResolvedValueOnce(ok({ query: 'test', provider: 'exa', hits: [], tookMs: 1 }));
        const provider: SearchProvider = {
            name: 'exa',
            isAvailable: () => true,
            search: searchFn,
        };
        const service = new SearchService({
            providers: [provider],
            retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 },
        });
        const r = await service.search({ text: 'test' });
        expect(r.ok).toBe(true);
        expect(searchFn).toHaveBeenCalledTimes(2);
    });

    it('advances to the next provider after retries are exhausted', async () => {
        const failing: SearchProvider = {
            name: 'failing',
            isAvailable: () => true,
            search: vi
                .fn()
                .mockResolvedValue(err(appError('network', 'always down', { retryable: true }))),
        };
        const working: SearchProvider = {
            name: 'working',
            isAvailable: () => true,
            search: vi
                .fn()
                .mockResolvedValue(ok({ query: 'test', provider: 'working', hits: [], tookMs: 1 })),
        };
        const service = new SearchService({
            providers: [failing, working],
            retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 10 },
        });
        const r = await service.search({ text: 'test' });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.provider).toBe('working');
        // failing called 2x (initial + 1 retry), working called 1x
        expect(failing.search).toHaveBeenCalledTimes(2);
        expect(working.search).toHaveBeenCalledTimes(1);
    });
});

describe('cleanHighlight (snippet noise filter)', () => {
    it('strips mdbook navigation chrome', () => {
        const raw = [
            '## Keyboard shortcuts',
            'Press \u2190 or \u2192 to navigate between chapters',
            'Press S or / to search in the book',
            'Press ? to show this help',
            'Press Esc to hide this help',
            '- Auto',
            '- Light',
            '- Rust',
            '- Coal',
            '- Navy',
            '- Ayu',
            'The actual content of the page explains async traits in detail.',
        ].join('\n');
        const cleaned = cleanHighlight(raw);
        expect(cleaned).toBe('The actual content of the page explains async traits in detail.');
        expect(cleaned).not.toContain('navigate between chapters');
        expect(cleaned).not.toContain('Keyboard shortcuts');
        expect(cleaned).not.toContain('Ayu');
    });

    it('strips markdown heading markers and bare date stamps', () => {
        const raw =
            '###### OpenCode news\nJune 17, 2026\nThis release ships copyable range types and assert_matches.';
        const cleaned = cleanHighlight(raw);
        expect(cleaned).not.toContain('######');
        expect(cleaned).not.toContain('June 17, 2026');
        expect(cleaned).toContain('copyable range types');
    });

    it('drops subscribe/sign-in/share boilerplate', () => {
        const raw =
            'Subscribe\nSign in\nShare\nFollow\nRust 1.96 stabilizes several const trait APIs.';
        const cleaned = cleanHighlight(raw);
        expect(cleaned).toBe('Rust 1.96 stabilizes several const trait APIs.');
    });

    it('collapses internal whitespace', () => {
        expect(cleanHighlight('Rust   1.96   adds\n\ncopyable ranges today.')).toBe(
            'Rust 1.96 adds copyable ranges today.',
        );
    });

    it('returns empty for pure-noise input', () => {
        const raw = '## Keyboard shortcuts\nPress ? to show this help\n- Auto\n- Light';
        expect(cleanHighlight(raw)).toBe('');
    });
});

describe('ExaSearchProvider snippet sourcing', () => {
    it('prefers the clean summary over noisy highlights', async () => {
        const provider = new ExaSearchProvider(config);
        const fakeExa = {
            searchAndContents: vi.fn().mockResolvedValue({
                results: [
                    {
                        url: 'https://docs.example.com',
                        title: 'Docs',
                        summary: 'A concise LLM summary of the page content.',
                        highlights: ['Press \u2190 or \u2192 to navigate between chapters'],
                        text: 'raw text',
                    },
                ],
            }),
        };
        (provider as unknown as { exaClient: () => unknown }).exaClient = () => fakeExa;

        const r = await provider.search({ text: 'test' });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.hits[0]?.snippet).toBe('A concise LLM summary of the page content.');
        }
    });

    it('requests summary in addition to highlights', async () => {
        const provider = new ExaSearchProvider(config);
        const fakeExa = { searchAndContents: vi.fn().mockResolvedValue({ results: [] }) };
        (provider as unknown as { exaClient: () => unknown }).exaClient = () => fakeExa;

        await provider.search({ text: 'test' });
        const options = fakeExa.searchAndContents.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(options.summary).toBe(true);
        expect(options.highlights).toBe(true);
    });

    it('falls back to cleaned highlights when summary is absent', async () => {
        const provider = new ExaSearchProvider(config);
        const fakeExa = {
            searchAndContents: vi.fn().mockResolvedValue({
                results: [
                    {
                        url: 'https://x.com',
                        title: 'X',
                        highlights: ['Press ? to show this help\nRust 1.96 adds copyable ranges.'],
                    },
                ],
            }),
        };
        (provider as unknown as { exaClient: () => unknown }).exaClient = () => fakeExa;

        const r = await provider.search({ text: 'test' });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.hits[0]?.snippet).toBe('Rust 1.96 adds copyable ranges.');
        }
    });
});
