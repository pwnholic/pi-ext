import { Exa } from 'exa-js';
import type { AppConfig } from '../../../core/config.js';
import { appError, toError } from '../../../core/errors.js';
import { err, fromPromise, type Result } from '../../../core/result.js';
import { isTimeoutError, raceAbort, withTimeout } from '../../../core/timeout.js';
import type { AnswerCitation, AnswerQuery, AnswerResponse } from '../answer.types.js';
import type { AnswerProvider } from './provider.js';

/** Minimal shape we consume from Exa answer citations. */
interface ExaCitationLike {
    url: string;
    title?: string | null;
    publishedDate?: string | null;
    author?: string | null;
    text?: string | null;
}

interface ExaAnswerResponseLike {
    answer: string;
    citations?: ExaCitationLike[];
}

/**
 * Exa-backed answer provider. Uses `exa.answer()` to get an LLM-synthesized
 * answer informed by Exa search results, with citations to sources.
 *
 * Max-quality settings: `text: true` so citations include full source text
 * for downstream processing.
 */
export class ExaAnswerProvider implements AnswerProvider {
    readonly name = 'exa';
    private client: Exa | undefined;

    constructor(private readonly config: AppConfig) {}

    isAvailable(): boolean {
        return Boolean(this.config.search.exaApiKey);
    }

    async answer(query: AnswerQuery, signal?: AbortSignal): Promise<Result<AnswerResponse>> {
        if (!this.isAvailable()) {
            return err(
                appError('provider_unavailable', 'Exa API key not configured', {
                    source: this.name,
                }),
            );
        }
        if (signal?.aborted) {
            return err(appError('aborted', 'Answer aborted', { source: this.name }));
        }

        const startedAt = Date.now();
        const timeoutMs = this.config.search.timeoutMs * 3;

        return fromPromise(
            (async (): Promise<AnswerResponse> => {
                const signal = withTimeout(undefined, timeoutMs);
                const response = (await raceAbort(
                    this.exa().answer(query.query, {
                        text: true,
                    }) as unknown as Promise<ExaAnswerResponseLike>,
                    signal,
                )) as ExaAnswerResponseLike;

                const citations: AnswerCitation[] = (response.citations ?? []).map((c) => ({
                    title: c.title ?? '',
                    url: c.url,
                    ...(c.publishedDate ? { publishedDate: c.publishedDate } : {}),
                    ...(c.author ? { author: c.author } : {}),
                    ...(c.text ? { text: c.text } : {}),
                }));

                return {
                    answer: response.answer,
                    citations,
                    tookMs: Date.now() - startedAt,
                };
            })(),
            (cause) => {
                if (isTimeoutError(cause)) {
                    return appError('timeout', `Exa answer timed out after ${timeoutMs}ms`, {
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
