import { type ContentStore, renderDocOutline, type StoredDoc } from '../../core/content-store.js';
import { buildSections } from '../../core/sections.js';
import type { Fetcher } from '../../modules/fetch/fetch.service.js';
import type { FetchedDocument } from '../../modules/fetch/fetch.types.js';
import type { Summarizer } from '../../modules/summarize/summarize.service.js';
import type { SummaryStyle } from '../../modules/summarize/summarize.types.js';
import type { ToolDefinition, ToolTextResult } from '../ports.js';

export interface FetchContentParams {
    url?: string;
    urls?: string[];
    impersonate?: string;
    /** When true, return an LLM summary of the page instead of full content. */
    summarize?: boolean;
    summaryStyle?: SummaryStyle;
    summarySentences?: number;
}

export interface FetchContentDeps {
    readonly fetch: Fetcher;
    readonly summarize: Summarizer;
    readonly content: ContentStore;
    readonly inlineMaxChars: number;
    readonly maxSectionChars: number;
}

/**
 * Adapts the `fetch_content` tool to the fetch + summarize services with
 * out-of-context storage. Small pages return inline; large pages are stored and
 * returned as a navigable section outline (retrieve detail via `get_content`),
 * keeping the context window lean. `summarize` returns an LLM summary instead.
 */
export function createFetchContentTool(deps: FetchContentDeps): ToolDefinition<FetchContentParams> {
    return {
        name: 'fetch_content',
        label: 'Fetch Content',
        description:
            'Fetch URL(s) using impers (curl-impersonate) and return readable content as markdown. ' +
            'Bypasses common bot protection via browser TLS/HTTP fingerprint impersonation. ' +
            'Large pages return a section outline (retrieve detail with get_content) to keep the context lean. ' +
            'Set `summarize: true` to return a concise LLM summary instead.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string' },
                urls: { type: 'array', items: { type: 'string' } },
                impersonate: { type: 'string' },
                summarize: { type: 'boolean' },
                summaryStyle: { type: 'string', enum: ['sentences', 'bullets'] },
                summarySentences: { type: 'number' },
            },
        },
        async execute(params, signal): Promise<ToolTextResult> {
            const urls = params.urls ?? (params.url ? [params.url] : []);
            if (urls.length === 0) {
                return { content: [{ type: 'text', text: 'Error: provide `url` or `urls`.' }] };
            }

            const results = await Promise.all(
                urls.map((url) =>
                    deps.fetch.fetch(
                        { url, ...(params.impersonate ? { impersonate: params.impersonate } : {}) },
                        signal,
                    ),
                ),
            );

            // Store full content of every successful fetch for out-of-context retrieval.
            const docs: StoredDoc[] = [];
            const docIndexByResult = results.map((r) => {
                if (!r.ok) return -1;
                const index = docs.length;
                docs.push(toStoredDoc(r.value, deps.maxSectionChars));
                return index;
            });
            const responseId = docs.length > 0 ? deps.content.put(docs) : undefined;

            const blocks = await Promise.all(
                results.map((r, i) =>
                    renderResult(
                        deps,
                        params,
                        r,
                        urls[i] ?? '',
                        docIndexByResult[i] ?? -1,
                        docs,
                        responseId,
                        signal,
                    ),
                ),
            );

            return {
                content: [{ type: 'text', text: blocks.join('\n\n---\n\n') }],
                details: {
                    urls: urls.length,
                    ...(responseId ? { responseId } : {}),
                    summarized: Boolean(params.summarize),
                },
            };
        },
    };
}

async function renderResult(
    deps: FetchContentDeps,
    params: FetchContentParams,
    result: Awaited<ReturnType<Fetcher['fetch']>>,
    url: string,
    docIndex: number,
    docs: readonly StoredDoc[],
    responseId: string | undefined,
    signal: AbortSignal,
): Promise<string> {
    if (!result.ok) return `Fetch "${url}" failed: ${result.error.message}`;
    const doc = result.value;

    if (params.summarize) {
        const summary = await summarizeDocument(deps.summarize, doc, params, signal);
        return responseId
            ? `${summary}\n\n> Full page stored: get_content({ responseId: "${responseId}", index: ${docIndex} })`
            : summary;
    }

    if (doc.content.length <= deps.inlineMaxChars) {
        return formatDocument(doc);
    }

    // Large page: return a navigable outline instead of flooding the context.
    const stored = docs[docIndex];
    if (!stored) return formatDocument(doc);
    return (
        `${renderDocOutline(stored, docIndex)}\n\n` +
        `> Large page (${stored.totalChars} chars) stored. ` +
        `Get a section: get_content({ responseId: "${responseId}", index: ${docIndex}, section: "<id>" }); ` +
        `search: get_content({ responseId: "${responseId}", index: ${docIndex}, query: "..." }).`
    );
}

function toStoredDoc(doc: FetchedDocument, maxSectionChars: number): StoredDoc {
    return {
        url: doc.finalUrl,
        title: doc.title,
        sections: buildSections(doc.content, maxSectionChars),
        fullContent: doc.content,
        totalChars: doc.content.length,
    };
}

async function summarizeDocument(
    service: Summarizer,
    doc: FetchedDocument,
    params: FetchContentParams,
    signal: AbortSignal,
): Promise<string> {
    const r = await service.summarize(
        doc.content,
        {
            ...(params.summaryStyle ? { style: params.summaryStyle } : {}),
            ...(params.summarySentences !== undefined
                ? { maxSentences: params.summarySentences }
                : {}),
        },
        signal,
    );
    if (r.ok) {
        return `# Summary: ${doc.title || doc.url}\n<${doc.finalUrl}>\n\n${r.value.summary}`;
    }
    return `${formatDocument(doc)}\n\n> Summary unavailable: ${r.error.message}`;
}

function formatDocument(doc: FetchedDocument): string {
    return `# ${doc.title || doc.url}\n<${doc.finalUrl}> (${doc.status}, ${doc.kind})\n\n${doc.content}`;
}
