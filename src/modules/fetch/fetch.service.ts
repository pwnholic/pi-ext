import { appError } from '../../core/errors.js';
import { err, ok, type Result } from '../../core/result.js';
import { type RetryConfig, retry } from '../../core/retry.js';
import type { FetchedDocument, FetchRequest } from './fetch.types.js';
import type { FetchProvider } from './providers/provider.js';

/** Capability interface so decorators (cache, telemetry) can wrap the service. */
export interface Fetcher {
    fetch(request: FetchRequest, signal?: AbortSignal): Promise<Result<FetchedDocument>>;
}

export interface FetchServiceDeps {
    readonly providers: readonly FetchProvider[];
    /** Retry config for transient failures. When omitted, no retries. */
    readonly retry?: RetryConfig;
}

/**
 * Orchestrates content fetching. Selects providers that can handle the URL and
 * are available, then tries them in order. Each provider is retried on transient
 * failures with exponential backoff before advancing to the next. Aborts and
 * non-retryable errors stop immediately.
 */
export class FetchService implements Fetcher {
    private readonly providers: readonly FetchProvider[];
    private readonly retryConfig: RetryConfig | undefined;

    constructor(deps: FetchServiceDeps) {
        this.providers = deps.providers;
        this.retryConfig = deps.retry;
    }

    async fetch(request: FetchRequest, signal?: AbortSignal): Promise<Result<FetchedDocument>> {
        const candidates = this.providers.filter((p) => p.isAvailable() && p.canHandle(request));
        if (candidates.length === 0) {
            return err(
                appError('no_provider', `No fetch provider can handle: ${request.url}`, {
                    source: 'fetch',
                }),
            );
        }

        const failures: string[] = [];
        for (const provider of candidates) {
            if (signal?.aborted) break;
            const result = this.retryConfig
                ? await retry(() => provider.fetch(request, signal), this.retryConfig, signal)
                : await provider.fetch(request, signal);
            if (result.ok) return ok(result.value);
            failures.push(`${provider.name}: ${result.error.message}`);
            if (result.error.kind === 'aborted') break;
            if (!result.error.retryable) break;
        }

        return err(
            appError('unknown', `All fetch providers failed:\n  - ${failures.join('\n  - ')}`, {
                source: 'fetch',
            }),
        );
    }
}
