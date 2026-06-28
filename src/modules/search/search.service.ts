import { appError } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import { err, ok, type Result } from '../../core/result.js';
import type { SearchProvider } from './providers/provider.js';
import type { SearchQuery, SearchResponse } from './search.types.js';

/** Capability interface so decorators (cache, telemetry) can wrap the service. */
export interface Searcher {
    search(query: SearchQuery, signal?: AbortSignal): Promise<Result<SearchResponse>>;
}

export interface SearchServiceDeps {
    readonly logger: Logger;
    /** Ordered by preference; the service tries each available one in turn. */
    readonly providers: readonly SearchProvider[];
}

/**
 * Orchestrates a search across a prioritized provider chain and returns a
 * Result. Cross-cutting concerns (caching, activity, logging) are applied by
 * decorators in the composition layer, not here.
 */
export class SearchService implements Searcher {
    private readonly logger: Logger;
    private readonly providers: readonly SearchProvider[];

    constructor(deps: SearchServiceDeps) {
        this.logger = deps.logger.child({ module: 'search' });
        this.providers = deps.providers;
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
            const result = await provider.search(query, signal);
            if (result.ok) return ok(result.value);
            failures.push(`${provider.name}: ${result.error.message}`);
            this.logger.warn('provider failed, falling back', { provider: provider.name });
            if (result.error.kind === 'aborted') break;
        }

        return err(
            appError('unknown', `All search providers failed:\n  - ${failures.join('\n  - ')}`, {
                source: 'search',
            }),
        );
    }
}
