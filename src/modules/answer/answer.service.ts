import { appError } from '../../core/errors.js';
import { err, ok, type Result } from '../../core/result.js';
import { type RetryConfig, retry } from '../../core/retry.js';
import type { AnswerQuery, AnswerResponse } from './answer.types.js';
import type { AnswerProvider } from './providers/provider.js';

/** Capability interface so the cache decorator can wrap the service. */
export interface Answerer {
    answer(query: AnswerQuery, signal?: AbortSignal): Promise<Result<AnswerResponse>>;
}

export interface AnswerServiceDeps {
    readonly providers: readonly AnswerProvider[];
    /** Retry config for transient failures. When omitted, no retries. */
    readonly retry?: RetryConfig;
}

/**
 * Orchestrates a Q&A across a prioritized provider chain and returns a Result.
 * Each provider is retried on transient failures with exponential backoff
 * before advancing to the next.
 */
export class AnswerService implements Answerer {
    private readonly providers: readonly AnswerProvider[];
    private readonly retryConfig: RetryConfig | undefined;

    constructor(deps: AnswerServiceDeps) {
        this.providers = deps.providers;
        this.retryConfig = deps.retry;
    }

    async answer(query: AnswerQuery, signal?: AbortSignal): Promise<Result<AnswerResponse>> {
        const available = this.providers.filter((p) => p.isAvailable());
        if (available.length === 0) {
            return err(
                appError('no_provider', 'No answer provider is configured', { source: 'answer' }),
            );
        }

        const failures: string[] = [];
        for (const provider of available) {
            if (signal?.aborted) break;
            const result = this.retryConfig
                ? await retry(() => provider.answer(query, signal), this.retryConfig, signal)
                : await provider.answer(query, signal);
            if (result.ok) return ok(result.value);
            failures.push(`${provider.name}: ${result.error.message}`);
            if (result.error.kind === 'aborted') break;
            if (!result.error.retryable) break;
        }

        return err(
            appError('unknown', `All answer providers failed:\n  - ${failures.join('\n  - ')}`, {
                source: 'answer',
            }),
        );
    }
}
