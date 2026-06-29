import type { AppError } from './errors.js';
import type { Result } from './result.js';

/** Retry configuration for transient failures. */
export interface RetryConfig {
    readonly maxRetries: number;
    /** Base delay in ms for the first retry; subsequent delays double. */
    readonly baseDelayMs: number;
    /** Upper bound on the delay between retries. */
    readonly maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryConfig = {
    maxRetries: 2,
    baseDelayMs: 300,
    maxDelayMs: 3_000,
};

/**
 * Sleep that resolves after `ms`, or rejects immediately if the signal aborts.
 */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        if (signal) {
            signal.addEventListener(
                'abort',
                () => {
                    clearTimeout(timer);
                    reject(signal.reason ?? new Error('Aborted'));
                },
                { once: true },
            );
        }
    });
}

/**
 * Retry an async Result operation on retryable failures with exponential
 * backoff. Non-retryable errors and aborted errors stop immediately.
 *
 * - Calls `op()` up to `maxRetries + 1` times total.
 * - Only retries when `result.ok === false && result.error.retryable && error.kind !== 'aborted'`.
 * - The delay for attempt N is `min(baseDelayMs * 2^N, maxDelayMs)`.
 * - Respects the abort signal: if it fires during backoff, the remaining retries are skipped.
 */
export async function retry<T>(
    op: () => Promise<Result<T>>,
    config: RetryConfig = DEFAULT_RETRY,
    signal?: AbortSignal,
): Promise<Result<T>> {
    let lastResult: Result<T, AppError> = { ok: false, error: { kind: 'unknown', message: 'No attempt made', retryable: false } };
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        if (signal?.aborted) {
            return {
                ok: false,
                error: {
                    kind: 'aborted',
                    message: 'Operation aborted before attempt',
                    retryable: false,
                },
            };
        }

        lastResult = await op();

        if (lastResult.ok) return lastResult;
        if (!lastResult.error.retryable) return lastResult;
        if (lastResult.error.kind === 'aborted') return lastResult;
        if (attempt >= config.maxRetries) return lastResult;

        const delay = Math.min(config.baseDelayMs * 2 ** attempt, config.maxDelayMs);
        try {
            await sleep(delay, signal);
        } catch {
            // Aborted during backoff — return the last error.
            return lastResult;
        }
    }
    return lastResult ?? { ok: false, error: { kind: 'unknown', message: 'No result', retryable: false } };
}
