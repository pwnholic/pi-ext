import { appError } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import { err, ok, type Result } from '../../core/result.js';
import type { FetchedDocument, FetchRequest } from './fetch.types.js';
import type { FetchProvider } from './providers/provider.js';

/** Capability interface so decorators (cache, telemetry) can wrap the service. */
export interface Fetcher {
    fetch(request: FetchRequest, signal?: AbortSignal): Promise<Result<FetchedDocument>>;
}

export interface FetchServiceDeps {
    readonly logger: Logger;
    readonly providers: readonly FetchProvider[];
}

/**
 * Orchestrates content fetching. Selects providers that can handle the URL and
 * are available, then tries them in order. Retryable failures advance to the
 * next provider; aborts and non-retryable errors stop. Returns a Result;
 * caching/telemetry are applied by decorators in the composition layer.
 */
export class FetchService implements Fetcher {
    private readonly logger: Logger;
    private readonly providers: readonly FetchProvider[];

    constructor(deps: FetchServiceDeps) {
        this.logger = deps.logger.child({ module: 'fetch' });
        this.providers = deps.providers;
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
            const result = await provider.fetch(request, signal);
            if (result.ok) return ok(result.value);
            failures.push(`${provider.name}: ${result.error.message}`);
            this.logger.warn('provider failed, falling back', { provider: provider.name });
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
