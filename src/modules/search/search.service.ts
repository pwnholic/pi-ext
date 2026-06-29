import { appError } from '../../core/errors.js';
import { err, ok, type Result } from '../../core/result.js';
import { type RetryConfig, retry } from '../../core/retry.js';
import type { SearchProvider } from './providers/provider.js';
import type { SearchQuery, SearchResponse } from './search.types.js';

/** Capability interface so decorators (cache, telemetry) can wrap the service. */
export interface Searcher {
    search(query: SearchQuery, signal?: AbortSignal): Promise<Result<SearchResponse>>;
}

export interface SearchServiceDeps {
    /** Ordered by preference; the service tries each available one in turn. */
    readonly providers: readonly SearchProvider[];
    /** Retry config for transient failures. When omitted, no retries. */
    readonly retry?: RetryConfig;
}

/**
 * Orchestrates a search across a prioritized provider chain and returns a
 * Result. Each provider is retried on transient failures (network, timeout)
 * with exponential backoff before advancing to the next.
 */
export class SearchService implements Searcher {
    private readonly providers: readonly SearchProvider[];
    private readonly retryConfig: RetryConfig | undefined;

    constructor(deps: SearchServiceDeps) {
        this.providers = deps.providers;
        this.retryConfig = deps.retry;
    }

    async search(query: SearchQuery, signal?: AbortSignal): Promise<Result<SearchResponse>> {
        const available = this.providers.filter((p) => p.isAvailable());
        if (available.length === 0) {
            return err(
                appError('no_provider', 'No search provider is configured', { source: 'search' }),
            );
        }

        const failures: string[] = [];
        for (const provider of available) {
            if (signal?.aborted) break;
            const result = this.retryConfig
                ? await retry(() => provider.search(query, signal), this.retryConfig, signal)
                : await provider.search(query, signal);
            if (result.ok) return ok(result.value);
            failures.push(`${provider.name}: ${result.error.message}`);
            if (result.error.kind === 'aborted') break;
            if (!result.error.retryable) break;
        }

        return err(
            appError('unknown', `All search providers failed:\n  - ${failures.join('\n  - ')}`, {
                source: 'search',
            }),
        );
    }
}
