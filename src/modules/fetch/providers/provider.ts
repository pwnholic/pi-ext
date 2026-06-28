import type { Result } from '../../../core/result.js';
import type { FetchedDocument, FetchRequest } from '../fetch.types.js';

/**
 * A content-fetching backend. The primary provider uses impers
 * (curl-impersonate) to defeat bot blocking; extraction providers can be
 * chained as fallbacks for JS-heavy or blocked pages.
 */
export interface FetchProvider {
    readonly name: string;
    isAvailable(): boolean;
    /** Whether this provider can handle the given URL (scheme, host, etc.). */
    canHandle(request: FetchRequest): boolean;
    fetch(request: FetchRequest, signal?: AbortSignal): Promise<Result<FetchedDocument>>;
}
