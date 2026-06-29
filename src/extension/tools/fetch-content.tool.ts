import { Type } from 'typebox';
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
        description: [
            'Fetch URL(s) using impers (curl-impersonate) and return readable content as markdown.',
            'Bypasses common bot protection via browser TLS/HTTP fingerprint impersonation.',
            'Large pages (> 6,000 chars) are stored out-of-context and return a navigable',
            'section outline — retrieve detail via `get_content` using the returned `responseId`.',
            'Set `summarize: true` to return a concise LLM summary instead of full content.',
            '',
            '## Parameters',
            '- `url` (string)             Single URL to fetch. Must be http/https.',
            '- `urls` (string[])          Multiple URLs (max 3 concurrent — additional URLs queue).',
            '- `impersonate` (string)     Browser fingerprint: "chrome" (default), "safari", "firefox".',
            '- `summarize` (boolean)     When true, return an LLM summary instead of full content.',
            '- `summaryStyle` (string)    "sentences" (default) or "bullets".',
            '- `summarySentences` (number) Target length: sentence count for "sentences", bullet count for "bullets". Default 3.',
            '',
            '## Best Practices',
            '1. Use `urls` array to fetch 1-3 URLs concurrently. Never exceed 3 — they will queue.',
            '2. For data-dense pages, prefer summarize with bullets:',
            '   { url: "...", summarize: true, summaryStyle: "bullets", summarySentences: 5 }',
            '3. If a site returns 403/429 (blocked), retry with a different `impersonate` value:',
            '   "chrome" → "safari" → "firefox"',
            '4. ALWAYS save the `responseId` from the result details. It is the key for `get_content`.',
            '5. For large pages, the tool returns a section outline (not full content).',
            '   Use `get_content` with the responseId to navigate specific sections.',
            '',
            '## Anti-Patterns',
            '- Fetching > 3 URLs at once (silently queues, slow).',
            '- summarize: true with default "sentences" style on data-heavy pages (loses facts). Use "bullets" instead.',
            '- Ignoring the `responseId` in the result (cannot retrieve stored content later).',
        ].join('\n'),
        promptSnippet:
            'Fetch URL(s) via impers with browser TLS impersonation; max 3 concurrent URLs; large pages return a section outline — save the responseId for get_content; use summarize + bullets for quick fact extraction; retry with different impersonate on 403/429.',
        promptGuidelines: [
            'Fetch at most 3 URLs concurrently via the `urls` array. Additional URLs silently queue and slow down execution.',
            'ALWAYS save the `responseId` from the result details — it is the key for retrieving stored content via `get_content`.',
            'For data-dense pages (API docs, specs, comparisons), prefer summarize with bullets: { summarize: true, summaryStyle: "bullets", summarySentences: 5 }.',
            'For narrative content (articles, blog posts), use summarize with sentences: { summarize: true, summaryStyle: "sentences", summarySentences: 3 }.',
            'If a site returns 403 or 429 (blocked), retry with a different `impersonate` value: "chrome" (default) → "safari" → "firefox".',
            'Pages larger than 6,000 chars return a section outline, not full content. Use `get_content` with the responseId to navigate specific sections.',
            'Avoid fetching more than 3 URLs at once — they will queue silently and increase latency.',
        ],
        parameters: Type.Object({
            url: Type.Optional(Type.String()),
            urls: Type.Optional(Type.Array(Type.String())),
            impersonate: Type.Optional(Type.String()),
            summarize: Type.Optional(Type.Boolean()),
            summaryStyle: Type.Optional(
                Type.Union([Type.Literal('sentences'), Type.Literal('bullets')]),
            ),
            summarySentences: Type.Optional(Type.Number()),
        }),
        async execute(params, signal): Promise<ToolTextResult> {
            const urls = params.urls ?? (params.url ? [params.url] : []);
            if (urls.length === 0) {
                return { content: [{ type: 'text', text: 'Error: provide `url` or `urls`.' }] };
            }
            if (urls.length > 3) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: fetch_content accepts at most 3 URLs at once (got ${urls.length}). Queue them in batches of 3.`,
                        },
                    ],
                };
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
