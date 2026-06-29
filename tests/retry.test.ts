import { describe, expect, it, vi } from 'vitest';
import { appError } from '../src/core/errors.js';
import { err, ok } from '../src/core/result.js';
import { DEFAULT_RETRY, type RetryConfig, retry } from '../src/core/retry.js';

const fastRetry: RetryConfig = { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 };

describe('retry', () => {
    it('returns the result immediately on success', async () => {
        const op = vi.fn().mockResolvedValue(ok('done'));
        const r = await retry(op, fastRetry);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value).toBe('done');
        expect(op).toHaveBeenCalledTimes(1);
    });

    it('retries on retryable errors and succeeds', async () => {
        const op = vi
            .fn()
            .mockResolvedValueOnce(err(appError('network', 'down', { retryable: true })))
            .mockResolvedValueOnce(err(appError('timeout', 'slow', { retryable: true })))
            .mockResolvedValueOnce(ok('done'));

        const r = await retry(op, fastRetry);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value).toBe('done');
        expect(op).toHaveBeenCalledTimes(3);
    });

    it('does not retry on non-retryable errors', async () => {
        const op = vi
            .fn()
            .mockResolvedValue(err(appError('invalid_input', 'bad', { retryable: false })));
        const r = await retry(op, fastRetry);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.kind).toBe('invalid_input');
        expect(op).toHaveBeenCalledTimes(1);
    });

    it('does not retry on aborted errors', async () => {
        const op = vi.fn().mockResolvedValue(err(appError('aborted', 'cancelled')));
        const r = await retry(op, fastRetry);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.kind).toBe('aborted');
        expect(op).toHaveBeenCalledTimes(1);
    });

    it('stops after maxRetries attempts', async () => {
        const op = vi
            .fn()
            .mockResolvedValue(err(appError('network', 'always down', { retryable: true })));
        const r = await retry(op, fastRetry);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.message).toBe('always down');
        // maxRetries=3 means 4 total attempts (initial + 3 retries)
        expect(op).toHaveBeenCalledTimes(4);
    });

    it('respects the abort signal during backoff', async () => {
        const controller = new AbortController();
        let callCount = 0;
        const op = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                // Abort during the first backoff period
                setTimeout(() => controller.abort(new Error('aborted by caller')), 2);
            }
            return Promise.resolve(err(appError('network', 'down', { retryable: true })));
        });

        const config: RetryConfig = { maxRetries: 5, baseDelayMs: 100, maxDelayMs: 1000 };
        const r = await retry(op, config, controller.signal);
        expect(r.ok).toBe(false);
        // Should have been called at most twice (first failure triggers backoff, abort during backoff)
        expect(op.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('uses exponential backoff', async () => {
        const calls: number[] = [];
        const op = vi.fn().mockImplementation(() => {
            calls.push(Date.now());
            return Promise.resolve(err(appError('network', 'down', { retryable: true })));
        });

        const config: RetryConfig = { maxRetries: 2, baseDelayMs: 50, maxDelayMs: 500 };
        await retry(op, config);

        expect(calls.length).toBe(3); // initial + 2 retries
        const gap1 = (calls[1] ?? 0) - (calls[0] ?? 0);
        const gap2 = (calls[2] ?? 0) - (calls[1] ?? 0);
        // gap1 should be ~50ms, gap2 should be ~100ms
        expect(gap1).toBeGreaterThanOrEqual(40);
        expect(gap2).toBeGreaterThanOrEqual(80);
        expect(gap2).toBeGreaterThan(gap1);
    });
});

describe('DEFAULT_RETRY', () => {
    it('has sensible defaults', () => {
        expect(DEFAULT_RETRY.maxRetries).toBe(2);
        expect(DEFAULT_RETRY.baseDelayMs).toBe(300);
        expect(DEFAULT_RETRY.maxDelayMs).toBe(3_000);
    });
});
