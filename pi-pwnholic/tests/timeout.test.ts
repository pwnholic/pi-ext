import { describe, expect, it } from 'vitest';
import { isTimeoutError, raceAbort, withTimeout } from '../src/core/timeout.js';

describe('withTimeout', () => {
    it('creates a signal that is not immediately aborted', () => {
        const signal = withTimeout(undefined, 10_000);
        expect(signal.aborted).toBe(false);
    });

    it('returns the parent signal if already aborted', () => {
        const controller = new AbortController();
        controller.abort();
        const signal = withTimeout(controller.signal, 10_000);
        expect(signal.aborted).toBe(true);
    });
});

describe('raceAbort', () => {
    it('resolves normally when the promise settles before timeout', async () => {
        const controller = new AbortController();
        const result = await raceAbort(Promise.resolve('ok'), controller.signal);
        expect(result).toBe('ok');
    });

    it('rejects when the signal aborts before the promise settles', async () => {
        const controller = new AbortController();
        const slow = new Promise(() => {}); // never resolves
        setTimeout(() => controller.abort(new Error('aborted')), 10);

        await expect(raceAbort(slow, controller.signal)).rejects.toThrow('aborted');
    });

    it('rejects immediately if the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort(new Error('already aborted'));
        await expect(raceAbort(Promise.resolve('ok'), controller.signal)).rejects.toThrow(
            'already aborted',
        );
    });
});

describe('isTimeoutError', () => {
    it('detects TimeoutError', () => {
        const err = new DOMException('Timeout', 'TimeoutError');
        expect(isTimeoutError(err)).toBe(true);
    });

    it('detects AbortError with message Timeout', () => {
        const err = new Error('Timeout');
        err.name = 'AbortError';
        expect(isTimeoutError(err)).toBe(true);
    });

    it('returns false for unrelated errors', () => {
        expect(isTimeoutError(new Error('network'))).toBe(false);
        expect(isTimeoutError('not an error')).toBe(false);
        expect(isTimeoutError(null)).toBe(false);
    });
});
