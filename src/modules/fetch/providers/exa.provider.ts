import { Exa } from 'exa-js';
import type { AppConfig } from '../../../core/config.js';
import { appError, toError } from '../../../core/errors.js';
import { err, fromPromise, type Result } from '../../../core/result.js';
import { isTimeoutError, raceAbort, withTimeout } from '../../../core/timeout.js';
import type { FetchedDocument, FetchRequest } from '../fetch.types.js';
import type { FetchProvider } from './provider.js';

/** Minimal shape we consume from Exa contents results. */
interface ExaContentResultLike {
    url: string;
    title?: string | null;
    text?: string | null;
}

interface ExaContentResponseLike {
    results: ExaContentResultLike[];
    statuses?: { id: string; status: string; error?: { tag?: string } }[];
}

/** Generous character limit for Exa contents retrieval (max quality). */
const MAX_TEXT_CHARS = 100_000;

/**
 * Exa Contents API fetch provider. Uses `exa.getContents()` to extract clean,
 * LLM-ready content from any URL — including JavaScript-rendered pages and
 * PDFs that impers cannot handle. Serves as a fallback after impers.
 *
 * Max-quality settings: `text: { maxCharacters }` with a generous limit to
 * capture full page content. Exa's extraction pipeline handles noise removal
 * and markdown conversion internally.
 */
export class ExaContentsProvider implements FetchProvider {
    readonly name = 'exa-contents';
    private client: Exa | undefined;

    constructor(private readonly config: AppConfig) {}

    isAvailable(): boolean {
        return Boolean(this.config.search.exaApiKey);
    }

    canHandle(request: FetchRequest): boolean {
        try {
            const { protocol } = new URL(request.url);
            return protocol === 'http:' || protocol === 'https:';
        } catch {
            return false;
        }
    }

    async fetch(request: FetchRequest, signal?: AbortSignal): Promise<Result<FetchedDocument>> {
        if (!this.isAvailable()) {
            return err(
                appError('provider_unavailable', 'Exa API key not configured', {
                    source: this.name,
                }),
            );
        }
        if (signal?.aborted) {
            return err(appError('aborted', 'Fetch aborted', { source: this.name }));
        }
        if (!this.canHandle(request)) {
            return err(
                appError('invalid_input', `Unsupported URL: ${request.url}`, {
                    source: this.name,
                }),
            );
        }

        const startedAt = Date.now();
        const timeoutMs = this.config.fetch.timeoutMs;

        return fromPromise(
            (async (): Promise<FetchedDocument> => {
                const signal = withTimeout(undefined, timeoutMs);
                const response = (await raceAbort(
                    this.exa().getContents([request.url], {
                        text: { maxCharacters: MAX_TEXT_CHARS },
                    }) as unknown as Promise<ExaContentResponseLike>,
                    signal,
                )) as ExaContentResponseLike;

                // Check per-URL status for errors.
                const status = response.statuses?.find((s) => s.id === request.url);
                if (status?.status === 'error') {
                    const tag = status.error?.tag ?? 'unknown';
                    if (tag === 'CRAWL_NOT_FOUND') {
                        throw new Error(`404 Not Found: ${request.url}`);
                    }
                    if (tag === 'SOURCE_NOT_AVAILABLE') {
                        throw new Error(`403 Forbidden: ${request.url}`);
                    }
                    throw new Error(`Exa contents error (${tag}): ${request.url}`);
                }

                const result = response.results[0];
                if (!result) {
                    throw new Error(`No content returned for: ${request.url}`);
                }

                return {
                    url: request.url,
                    finalUrl: result.url ?? request.url,
                    status: 200,
                    title: result.title ?? request.url,
                    kind: 'markdown',
                    content: result.text ?? '',
                    tookMs: Date.now() - startedAt,
                };
            })(),
            (cause) => {
                if (isTimeoutError(cause)) {
                    return appError('timeout', `Exa contents timed out after ${timeoutMs}ms`, {
                        source: this.name,
                        retryable: true,
                    });
                }
                return toError(cause, this.name);
            },
        );
    }

    private exa(): Exa {
        if (!this.client) {
            const apiKey = this.config.search.exaApiKey;
            // Guarded by isAvailable() before any call path reaches here.
            if (!apiKey) throw new Error('Exa API key not configured');
            this.client = new Exa(apiKey);
        }
        return this.client;
    }
}
