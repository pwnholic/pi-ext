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
    /** Custom instruction guiding what the summary focuses on (requires `summarize: true`). */
    summaryPrompt?: string;
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
            'Fetch URL(s) with browser TLS fingerprint impersonation (curl-impersonate).',
            'Returns readable content as markdown, with options for LLM summarization.',
            '',
            '## Behavior',
            '- Bypasses bot protection via browser TLS/HTTP fingerprint impersonation.',
            '- Large pages (>6,000 chars): returns section outline only. Use `get_content` with `responseId` to retrieve sections.',
            '- Small pages (≤6,000 chars): returns full markdown content.',
            '',
            '## Parameters',
            '| Param | Type | Default | Description |',
            '|-------|------|---------|-------------|',
            '| `url` | string | - | Single URL (http/https). Mutually exclusive with `urls`. |',
            '| `urls` | string[] | - | Multiple URLs (max 3 concurrent). |',
            '| `impersonate` | string | "chrome" | Browser fingerprint: "chrome", "safari", or "firefox". |',
            '| `summarize` | boolean | false | Return LLM summary instead of full content. |',
            '| `summaryStyle` | string | "sentences" | "sentences" or "bullets". |',
            '| `summarySentences` | number | 3 | Target length: sentence count or bullet count. |',
            '| `summaryPrompt` | string | null | Custom focus instruction (requires `summarize: true`). |',
            '',
            '## Output Format',
            'Each URL result is separated by `---`.',
            'Successful fetch includes: URL, content/outline, and `responseId` if content was stored.',
            'Failed fetch includes: URL, error status, and suggested action.',
            '',
            '## Error Handling',
            '- 403/429: Site blocked the request. Retry with different `impersonate` value.',
            '- Timeout: Network issue. Retry once, then report failure.',
            '- Invalid URL: Returns error immediately without fetching.',
            '- >3 URLs: Returns error. Split into batches of 3.',
        ].join('\n'),

        promptSnippet:
            'Fetch 1-3 URLs with TLS impersonation. Large pages return outlines — save `responseId` for `get_content`. Use `summarize: true` + `bullets` for data extraction. On 403/429, retry with different `impersonate`.',

        promptGuidelines: [
            // Concurrency
            'Fetch at most 3 URLs per call via `urls` array. Never exceed — it returns an error, not a queue.',
            '',
            // Response ID handling
            'ALWAYS capture `responseId` from the result. It is required to retrieve stored content via `get_content`.',
            '',
            // Summarization strategy
            'For data-dense pages (API docs, specs, comparisons, pricing):',
            '  { url: "...", summarize: true, summaryStyle: "bullets", summarySentences: 5 }',
            '',
            'For narrative content (articles, blog posts, news):',
            '  { url: "...", summarize: true, summaryStyle: "sentences", summarySentences: 3 }',
            '',
            'For focused extraction (e.g., pricing only):',
            '  { url: "...", summarize: true, summaryStyle: "bullets", summarySentences: 5, summaryPrompt: "Extract only pricing tiers and limits" }',
            '',
            // Fallback strategy
            'If blocked (403/429), retry in this order: "chrome" → "safari" → "firefox".',
            '',
            // Large page handling
            'Pages >6,000 chars return a section outline. To get specific sections:',
            '  1. Note the `responseId` from the result',
            '  2. Call `get_content` with that `responseId` and desired section index/range',
        ],

        parameters: Type.Object({
            url: Type.Optional(Type.String({ description: 'Single URL to fetch (http/https)' })),
            urls: Type.Optional(
                Type.Array(Type.String(), {
                    description: 'Multiple URLs to fetch (max 3)',
                    maxItems: 3,
                }),
            ),
            impersonate: Type.Optional(
                Type.String({
                    description: 'Browser fingerprint to impersonate',
                    enum: ['chrome', 'safari', 'firefox'],
                    default: 'chrome',
                }),
            ),
            summarize: Type.Optional(
                Type.Boolean({
                    description: 'Return LLM summary instead of full content',
                    default: false,
                }),
            ),
            summaryStyle: Type.Optional(
                Type.Union([Type.Literal('sentences'), Type.Literal('bullets')], {
                    description: 'Summary format style',
                }),
            ),
            summarySentences: Type.Optional(
                Type.Number({
                    description: 'Target length (sentence count or bullet count)',
                    minimum: 1,
                    maximum: 20,
                    default: 3,
                }),
            ),
            summaryPrompt: Type.Optional(
                Type.String({
                    description:
                        'Custom instruction for what the summary focuses on (requires summarize: true). Replaces the default generic instruction; length/format from style still apply.',
                }),
            ),
        }),

        async execute(params, signal): Promise<ToolTextResult> {
            const urls = params.urls ?? (params.url ? [params.url] : []);

            if (urls.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Error: Provide either `url` or `urls` parameter.',
                        },
                    ],
                };
            }

            // Clearer error message with guidance
            if (urls.length > 3) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: [
                                `Error: Maximum 3 URLs per call (received ${urls.length}).`,
                                '',
                                'Split your request into batches:',
                                `  Batch 1: ${urls
                                    .slice(0, 3)
                                    .map((u) => `"${u}"`)
                                    .join(', ')}`,
                                `  Batch 2: ${urls
                                    .slice(3, 6)
                                    .map((u) => `"${u}"`)
                                    .join(', ')}`,
                                `  ... (${Math.ceil(urls.length / 3)} batches total)`,
                            ]
                                .filter(Boolean)
                                .join('\n'),
                        },
                    ],
                };
            }

            // Validate URLs before fetching
            const invalidUrls = urls.filter((u) => !u.match(/^https?:\/\//i));
            if (invalidUrls.length > 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: Invalid URL format (must be http/https): ${invalidUrls.map((u) => `"${u}"`).join(', ')}`,
                        },
                    ],
                };
            }

            const fetchParams = {
                ...(params.impersonate ? { impersonate: params.impersonate } : {}),
            };

            const results = await Promise.all(
                urls.map((url) => deps.fetch.fetch({ url, ...fetchParams }, signal)),
            );

            // Store full content for out-of-context retrieval
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

    const stored = docs[docIndex];
    let failureNote: string | undefined;

    if (params.summarize) {
        const outcome = await trySummarize(deps.summarize, doc, params, signal);
        if (outcome.summary !== undefined) {
            return responseId
                ? `${outcome.summary}\n\n> Full page stored: get_content({ responseId: "${responseId}", index: ${docIndex} })`
                : outcome.summary;
        }
        // Summary failed: degrade to the normal compact rendering below (never
        // dump the full page). Surface a one-line reason for diagnostics.
        failureNote = outcome.reason;
    }

    if (doc.content.length <= deps.inlineMaxChars) {
        return failureNote
            ? `${formatDocument(doc)}\n\n> Summary unavailable: ${failureNote}`
            : formatDocument(doc);
    }

    // Large page: return a navigable outline instead of flooding the context.
    if (!stored || !responseId) return formatDocument(doc);
    return failureNote
        ? `${outlineBlock(stored, docIndex, responseId)}\n\n> Summary unavailable: ${failureNote}`
        : outlineBlock(stored, docIndex, responseId);
}

function outlineBlock(stored: StoredDoc, docIndex: number, responseId: string): string {
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

/** Returns the formatted summary, or a reason when summarization failed. */
async function trySummarize(
    service: Summarizer,
    doc: FetchedDocument,
    params: FetchContentParams,
    signal: AbortSignal,
): Promise<{ summary?: string; reason?: string }> {
    const r = await service.summarize(
        doc.content,
        {
            ...(params.summaryStyle ? { style: params.summaryStyle } : {}),
            ...(params.summarySentences !== undefined
                ? { maxSentences: params.summarySentences }
                : {}),
            ...(params.summaryPrompt ? { systemPrompt: params.summaryPrompt } : {}),
        },
        signal,
    );
    if (r.ok) {
        return {
            summary: `# Summary: ${doc.title || doc.url}\n<${doc.finalUrl}>\n\n${r.value.summary}`,
        };
    }
    return { reason: `${r.error.kind}: ${r.error.message}` };
}

function formatDocument(doc: FetchedDocument): string {
    return `# ${doc.title || doc.url}\n<${doc.finalUrl}> (${doc.status}, ${doc.kind})\n\n${doc.content}`;
}
