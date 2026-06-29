import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import { appError } from '../src/core/errors.js';
import { err, ok } from '../src/core/result.js';
import { AnswerService } from '../src/modules/answer/answer.service.js';
import type { AnswerResponse } from '../src/modules/answer/answer.types.js';
import { ExaAnswerProvider } from '../src/modules/answer/providers/exa.provider.js';
import type { AnswerProvider } from '../src/modules/answer/providers/provider.js';

const config = { ...DEFAULT_CONFIG, search: { ...DEFAULT_CONFIG.search, exaApiKey: 'test-key' } };

function fakeAnswerResponse(): AnswerResponse {
    return {
        answer: 'Paris is the capital of France.',
        citations: [
            {
                title: 'France Wiki',
                url: 'https://en.wikipedia.org/wiki/France',
                author: 'Wikipedia',
            },
        ],
        tookMs: 42,
    };
}

describe('ExaAnswerProvider', () => {
    it('returns provider_unavailable without an API key', async () => {
        const provider = new ExaAnswerProvider({ ...DEFAULT_CONFIG });
        const r = await provider.answer({ query: 'test' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.kind).toBe('provider_unavailable');
    });

    it('returns the synthesized answer with citations', async () => {
        const provider = new ExaAnswerProvider(config);
        // Mock the internal Exa client
        const fakeExa = {
            answer: vi.fn().mockResolvedValue({
                answer: 'Paris is the capital of France.',
                citations: [
                    {
                        title: 'France Wiki',
                        url: 'https://en.wikipedia.org/wiki/France',
                        author: 'Wikipedia',
                    },
                ],
            }),
        };
        // Access private method via bracket notation
        (provider as unknown as { exa: () => unknown }).exa = () => fakeExa;

        const r = await provider.answer({ query: 'capital of France' });

        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.answer).toBe('Paris is the capital of France.');
            expect(r.value.citations).toHaveLength(1);
            expect(r.value.citations[0]?.url).toBe('https://en.wikipedia.org/wiki/France');
            expect(r.value.citations[0]?.author).toBe('Wikipedia');
        }
        expect(fakeExa.answer).toHaveBeenCalledWith('capital of France', { text: true });
    });

    it('maps unknown errors to AppError', async () => {
        const provider = new ExaAnswerProvider(config);
        const fakeExa = {
            answer: vi.fn().mockRejectedValue(new Error('network failure')),
        };
        (provider as unknown as { exa: () => unknown }).exa = () => fakeExa;

        const r = await provider.answer({ query: 'test' });
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.error.kind).toBe('unknown');
            expect(r.error.message).toContain('network failure');
        }
    });

    it('handles citations with missing fields', async () => {
        const provider = new ExaAnswerProvider(config);
        const fakeExa = {
            answer: vi.fn().mockResolvedValue({
                answer: 'Yes.',
                citations: [{ url: 'https://x.com' }], // no title, author, etc.
            }),
        };
        (provider as unknown as { exa: () => unknown }).exa = () => fakeExa;

        const r = await provider.answer({ query: 'test' });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.citations[0]?.title).toBe('');
            expect(r.value.citations[0]?.url).toBe('https://x.com');
        }
    });
});

describe('AnswerService', () => {
    it('returns no_provider when no providers are available', async () => {
        const service = new AnswerService({ providers: [] });
        const r = await service.answer({ query: 'test' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.kind).toBe('no_provider');
    });

    it('tries the first available provider', async () => {
        const provider: AnswerProvider = {
            name: 'fake',
            isAvailable: () => true,
            answer: vi.fn().mockResolvedValue(ok(fakeAnswerResponse())),
        };
        const service = new AnswerService({ providers: [provider] });
        const r = await service.answer({ query: 'test' });
        expect(r.ok).toBe(true);
    });

    it('falls back to the next provider on retryable errors', async () => {
        const failing: AnswerProvider = {
            name: 'failing',
            isAvailable: () => true,
            answer: vi
                .fn()
                .mockResolvedValue(err(appError('network', 'timeout', { retryable: true }))),
        };
        const working: AnswerProvider = {
            name: 'working',
            isAvailable: () => true,
            answer: vi.fn().mockResolvedValue(ok(fakeAnswerResponse())),
        };
        const service = new AnswerService({ providers: [failing, working] });
        const r = await service.answer({ query: 'test' });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.answer).toBe('Paris is the capital of France.');
    });

    it('stops on aborted errors and does not try the next provider', async () => {
        const aborted: AnswerProvider = {
            name: 'aborted',
            isAvailable: () => true,
            answer: vi.fn().mockResolvedValue(err(appError('aborted', 'cancelled'))),
        };
        const working: AnswerProvider = {
            name: 'working',
            isAvailable: () => true,
            answer: vi.fn().mockResolvedValue(ok(fakeAnswerResponse())),
        };
        const service = new AnswerService({ providers: [aborted, working] });
        const r = await service.answer({ query: 'test' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.message).toContain('aborted');
        expect(working.answer).not.toHaveBeenCalled();
    });
});
