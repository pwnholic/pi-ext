import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import { ok } from '../src/core/result.js';
import { FetchService } from '../src/modules/fetch/fetch.service.js';
import type { FetchedDocument } from '../src/modules/fetch/fetch.types.js';
import { ExaContentsProvider } from '../src/modules/fetch/providers/exa.provider.js';
import type { FetchProvider } from '../src/modules/fetch/providers/provider.js';

const config = { ...DEFAULT_CONFIG, search: { ...DEFAULT_CONFIG.search, exaApiKey: 'test-key' } };

function fakeContentsResponse(url: string): unknown {
    return {
        results: [
            {
                url,
                title: 'Fetched Page',
                text: '# Heading\n\nClean markdown content from Exa.',
            },
        ],
        statuses: [{ id: url, status: 'success' }],
    };
}

describe('ExaContentsProvider', () => {
    it('returns provider_unavailable without an API key', async () => {
        const provider = new ExaContentsProvider({ ...DEFAULT_CONFIG });
        const r = await provider.fetch({ url: 'https://example.com' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.kind).toBe('provider_unavailable');
    });

    it('rejects non-http(s) URLs', async () => {
        const provider = new ExaContentsProvider(config);
        expect(provider.canHandle({ url: 'ftp://x.com' })).toBe(false);
        expect(provider.canHandle({ url: 'not-a-url' })).toBe(false);
        const r = await provider.fetch({ url: 'ftp://x.com' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.kind).toBe('invalid_input');
    });

    it('fetches clean markdown content via Exa Contents API', async () => {
        const provider = new ExaContentsProvider(config);
        const fakeExa = {
            getContents: vi
                .fn()
                .mockResolvedValue(fakeContentsResponse('https://example.com/article')),
        };
        (provider as unknown as { exa: () => unknown }).exa = () => fakeExa;

        const r = await provider.fetch({ url: 'https://example.com/article' });

        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.title).toBe('Fetched Page');
            expect(r.value.content).toContain('Clean markdown content');
            expect(r.value.kind).toBe('markdown');
            expect(r.value.status).toBe(200);
            expect(r.value.finalUrl).toBe('https://example.com/article');
        }
        expect(fakeExa.getContents).toHaveBeenCalledWith(
            ['https://example.com/article'],
            expect.objectContaining({ text: expect.any(Object) }),
        );
    });

    it('maps CRAWL_NOT_FOUND to an error', async () => {
        const provider = new ExaContentsProvider(config);
        const fakeExa = {
            getContents: vi.fn().mockResolvedValue({
                results: [],
                statuses: [
                    { id: 'https://gone.com', status: 'error', error: { tag: 'CRAWL_NOT_FOUND' } },
                ],
            }),
        };
        (provider as unknown as { exa: () => unknown }).exa = () => fakeExa;

        const r = await provider.fetch({ url: 'https://gone.com' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.message).toContain('404');
    });

    it('maps SOURCE_NOT_AVAILABLE to an error', async () => {
        const provider = new ExaContentsProvider(config);
        const fakeExa = {
            getContents: vi.fn().mockResolvedValue({
                results: [],
                statuses: [
                    {
                        id: 'https://blocked.com',
                        status: 'error',
                        error: { tag: 'SOURCE_NOT_AVAILABLE' },
                    },
                ],
            }),
        };
        (provider as unknown as { exa: () => unknown }).exa = () => fakeExa;

        const r = await provider.fetch({ url: 'https://blocked.com' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.message).toContain('403');
    });

    it('errors when no result is returned', async () => {
        const provider = new ExaContentsProvider(config);
        const fakeExa = {
            getContents: vi.fn().mockResolvedValue({
                results: [],
                statuses: [{ id: 'https://x.com', status: 'success' }],
            }),
        };
        (provider as unknown as { exa: () => unknown }).exa = () => fakeExa;

        const r = await provider.fetch({ url: 'https://x.com' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.message).toContain('No content');
    });

    it('maps unknown errors to AppError', async () => {
        const provider = new ExaContentsProvider(config);
        const fakeExa = {
            getContents: vi.fn().mockRejectedValue(new Error('connection refused')),
        };
        (provider as unknown as { exa: () => unknown }).exa = () => fakeExa;

        const r = await provider.fetch({ url: 'https://x.com' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.message).toContain('connection refused');
    });
});

describe('FetchService with Exa fallback', () => {
    it('falls back to Exa Contents when impers returns a retryable error', async () => {
        const impers: FetchProvider = {
            name: 'impers',
            isAvailable: () => true,
            canHandle: () => true,
            fetch: vi.fn().mockResolvedValue({
                ok: false,
                error: {
                    kind: 'invalid_input',
                    message: 'Unsupported content type (pdf)',
                    retryable: true,
                },
            }),
        };
        const exa: FetchProvider = {
            name: 'exa-contents',
            isAvailable: () => true,
            canHandle: () => true,
            fetch: vi.fn().mockResolvedValue(
                ok({
                    url: 'https://x.com/doc.pdf',
                    finalUrl: 'https://x.com/doc.pdf',
                    status: 200,
                    title: 'PDF via Exa',
                    kind: 'markdown',
                    content: '# PDF Content',
                    tookMs: 100,
                } satisfies FetchedDocument),
            ),
        };
        const service = new FetchService({ providers: [impers, exa] });
        const r = await service.fetch({ url: 'https://x.com/doc.pdf' });

        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.title).toBe('PDF via Exa');
        expect(exa.fetch).toHaveBeenCalled();
    });

    it('does not fall back on non-retryable errors', async () => {
        const impers: FetchProvider = {
            name: 'impers',
            isAvailable: () => true,
            canHandle: () => true,
            fetch: vi.fn().mockResolvedValue({
                ok: false,
                error: { kind: 'blocked', message: '403 Forbidden', retryable: false },
            }),
        };
        const exa: FetchProvider = {
            name: 'exa-contents',
            isAvailable: () => true,
            canHandle: () => true,
            fetch: vi.fn(),
        };
        const service = new FetchService({ providers: [impers, exa] });
        const r = await service.fetch({ url: 'https://x.com' });

        expect(r.ok).toBe(false);
        expect(exa.fetch).not.toHaveBeenCalled();
    });
});
