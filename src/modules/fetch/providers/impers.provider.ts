import { Session } from 'impers';
import type { AppConfig } from '../../../core/config.js';
import { appError, toError } from '../../../core/errors.js';
import { err, ok, type Result } from '../../../core/result.js';
import { extractContent, extractTitle, parseDocument } from '../extract/index.js';
import type { ContentKind, FetchedDocument, FetchRequest } from '../fetch.types.js';
import type { FetchProvider } from './provider.js';

/**
 * Primary fetch provider built on impers (curl-impersonate). A single Session
 * is reused so connection pooling, cookies, and the impersonation fingerprint
 * persist across requests within an extension session.
 *
 * HTML is run through the extraction pipeline (noise removal + readability-style
 * scoring + DOM-to-markdown) ported from webclaw, yielding clean markdown plus
 * harvested link/image/code assets.
 */
export class ImpersFetchProvider implements FetchProvider {
    readonly name = 'impers';
    private session: Session | undefined;

    constructor(private readonly config: AppConfig) {}

    isAvailable(): boolean {
        return true;
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
        try {
            const response = await this.getSession().get(request.url, {
                impersonate: request.impersonate ?? this.config.fetch.impersonate,
                timeout: Math.ceil(this.config.fetch.timeoutMs / 1000),
                ...(signal ? { signal } : {}),
            });

            const status = response.status;
            if (status === 404) {
                return err(
                    appError('not_found', `404 Not Found: ${request.url}`, {
                        source: this.name,
                    }),
                );
            }
            if (status === 403 || status === 401 || status === 429) {
                return err(
                    appError('blocked', `Blocked (${status}): ${request.url}`, {
                        source: this.name,
                        retryable: status === 429,
                    }),
                );
            }
            if (!response.ok) {
                return err(
                    appError('network', `HTTP ${status}: ${request.url}`, {
                        source: this.name,
                    }),
                );
            }

            const contentType = response.headers.get('content-type') ?? '';
            const kind = classify(contentType);
            const body = response.text;

            let content = body;
            let title = request.url;
            if (kind === 'html') {
                const doc = parseDocument(body);
                title = extractTitle(doc) || request.url;
                content = extractContent(body, response.url).markdown;
            }

            return ok({
                url: request.url,
                finalUrl: response.url,
                status,
                title,
                kind: kind === 'html' ? 'markdown' : kind,
                content,
                tookMs: Date.now() - startedAt,
            });
        } catch (cause) {
            return err(toError(cause, this.name));
        }
    }

    /** Releases the underlying curl session; call on session shutdown. */
    async close(): Promise<void> {
        await this.session?.close();
        this.session = undefined;
    }

    private getSession(): Session {
        if (!this.session) {
            this.session = new Session({
                impersonate: this.config.fetch.impersonate,
                timeout: Math.ceil(this.config.fetch.timeoutMs / 1000),
                ...(this.config.fetch.proxy ? { proxy: this.config.fetch.proxy } : {}),
            });
        }
        return this.session;
    }
}

function classify(contentType: string): ContentKind {
    const ct = contentType.toLowerCase();
    if (ct.includes('application/pdf')) return 'pdf';
    if (ct.includes('application/json')) return 'json';
    if (ct.includes('text/html') || ct.includes('application/xhtml')) return 'html';
    if (ct.includes('text/markdown')) return 'markdown';
    if (ct.startsWith('text/')) return 'text';
    return 'binary';
}
