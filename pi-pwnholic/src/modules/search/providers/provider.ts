import type { Result } from '../../../core/result.js';
import type { SearchQuery, SearchResponse } from '../search.types.js';

/**
 * A search backend. Providers are stateless and interchangeable; the service
 * picks the first available one and falls back on failure.
 */
export interface SearchProvider {
    readonly name: string;
    /** Cheap, synchronous readiness check (e.g. API key present). */
    isAvailable(): boolean;
    search(query: SearchQuery, signal?: AbortSignal): Promise<Result<SearchResponse>>;
}
