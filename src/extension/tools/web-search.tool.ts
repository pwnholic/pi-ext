import { Type } from 'typebox';
import type { Searcher } from '../../modules/search/search.service.js';
import type { SearchCategory, SearchQuery, SearchType } from '../../modules/search/search.types.js';
import type { ToolDefinition, ToolTextResult } from '../ports.js';

export interface WebSearchParams {
    query?: string;
    queries?: string[];
    numResults?: number;
    type?: SearchType;
    category?: SearchCategory;
    recency?: 'day' | 'week' | 'month' | 'year';
    domains?: string[];
    includeText?: string;
    excludeText?: string;
}

/**
 * Adapts the `web_search` tool surface to the SearchService. Keeps the tool
 * thin: parse/validate params, delegate, format the Result. Multiple queries
 * are searched concurrently.
 */
export function createWebSearchTool(service: Searcher): ToolDefinition<WebSearchParams> {
    return {
        name: 'web_search',
        label: 'Web Search',
        description: [
            'Search the web via Exa. Returns a list of relevant URLs with titles and snippets.',
            'Use for broad research, multiple perspectives, or finding specific sources.',
            'For direct factual answers with synthesized citations, use `exa_answer` instead.',
            '',
            '## Output Format',
            '```',
            '# web_search: "query" — 3 result(s)',
            '',
            '1. Title of the Result',
            '   https://example.com/page · Author Name',
            '   A brief excerpt from the page containing the relevant information...',
            '',
            '2. Another Title',
            '   https://...',
            '   ...',
            '```',
            '',
            '## Parameters',
            '| Param | Type | Default | Description |',
            '|-------|------|---------|-------------|',
            '| `query` | string | - | Single search query. Use only for simple lookups. |',
            '| `queries` | string[] | - | 2-4 varied-angle queries. PREFERRED over `query` for better coverage. |',
            '| `numResults` | number | 5 | Results per query. MAX 10. |',
            '| `type` | string | "auto" | "auto" (best for most), "fast", "instant", "deep-lite", "deep", "deep-reasoning". |',
            '| `category` | string | - | "company", "research paper", "news", "personal site", "financial report", "people". |',
            '| `recency` | string | - | "day", "week", "month", "year". |',
            '| `domains` | string[] | - | Include or exclude domains. Prefix with `-` to exclude (e.g. ["github.com", "-pinterest.com"]). |',
            '| `includeText` | string | - | String that MUST be in page text (max 5 words). |',
            '| `excludeText` | string | - | String that MUST NOT be in page text (max 5 words). |',
            '',
            '## Limitations',
            '- Does not return full page content. Use `fetch_content` on the returned URLs to read complete pages.',
            '- `numResults` > 10 is an error (Exa free-plan cap).',
            '- `includeText` and `excludeText` are limited to 5 words max.',
            '- `type: "deep"` has 4-15s latency. Use "auto" unless deep reasoning is strictly required.',
        ].join('\n'),
        promptSnippet:
            'Broad web search via Exa. ALWAYS prefer `queries` (2-4 varied angles) over single `query`. Follow up with `fetch_content` for full pages.',
        promptGuidelines: [
            'DECISION: web_search vs exa_answer?',
            '  - Need multiple sources/broad exploration -> web_search',
            '  - Need one direct factual answer with citations -> exa_answer',
            '',
            'QUERY STRATEGY:',
            '  - ALWAYS prefer `queries` (plural) with 2-4 varied angles over a single `query`.',
            '  - GOOD: { queries: ["rust async runtime comparison", "tokio vs async-std benchmarks", "rust async best practices 2024"] }',
            '  - BAD:  { query: "rust" }',
            '',
            'FILTERING:',
            '  - Time-sensitive (crypto, news, releases): { recency: "week" }',
            '  - Source type: { category: "news" } or { category: "research paper" }',
            '  - Domain control: { domains: ["github.com", "-medium.com"] }',
            '  - Content presence: { includeText: "benchmark results" } (max 5 words)',
            '',
            'SEARCH DEPTH:',
            '  - Default: { type: "auto" } (fast, good for most lookups)',
            '  - Complex multi-step reasoning: { type: "deep" } (expect 4-15s latency)',
            '',
            'FOLLOW-UP:',
            '  - Search returns titles and snippets ONLY.',
            '  - To analyze, extract data, or read full context, pass the URLs to `fetch_content`.',
        ],
        parameters: Type.Object({
            query: Type.Optional(
                Type.String({
                    description: 'Single search query. Use only for simple, targeted lookups.',
                }),
            ),
            queries: Type.Optional(
                Type.Array(Type.String(), {
                    description:
                        '2-4 varied-angle queries for broader coverage. Preferred over `query`.',
                    minItems: 2,
                    maxItems: 4,
                }),
            ),
            numResults: Type.Optional(
                Type.Number({
                    description: 'Number of results to return per query.',
                    minimum: 1,
                    maximum: 10,
                    default: 5,
                }),
            ),
            type: Type.Optional(
                Type.Union(
                    [
                        Type.Literal('auto'),
                        Type.Literal('fast'),
                        Type.Literal('instant'),
                        Type.Literal('deep-lite'),
                        Type.Literal('deep'),
                        Type.Literal('deep-reasoning'),
                    ],
                    {
                        description:
                            'Search depth. "auto" for most cases. "deep" for complex reasoning (slower).',
                        default: 'auto',
                    },
                ),
            ),
            category: Type.Optional(
                Type.Union(
                    [
                        Type.Literal('company'),
                        Type.Literal('research paper'),
                        Type.Literal('news'),
                        Type.Literal('personal site'),
                        Type.Literal('financial report'),
                        Type.Literal('people'),
                    ],
                    {
                        description: 'Scope results to a specific category of web pages.',
                    },
                ),
            ),
            recency: Type.Optional(
                Type.Union(
                    [
                        Type.Literal('day'),
                        Type.Literal('week'),
                        Type.Literal('month'),
                        Type.Literal('year'),
                    ],
                    {
                        description: 'Filter by publish date. Use for time-sensitive topics.',
                    },
                ),
            ),
            domains: Type.Optional(
                Type.Array(Type.String(), {
                    description:
                        'Include or exclude domains. Prefix with "-" to exclude (e.g. ["-pinterest.com"]).',
                }),
            ),
            includeText: Type.Optional(
                Type.String({
                    description: 'String that must be present in the webpage text (max 5 words).',
                }),
            ),
            excludeText: Type.Optional(
                Type.String({
                    description:
                        'String that must not be present in the webpage text (max 5 words).',
                }),
            ),
        }),

        async execute(params, signal): Promise<ToolTextResult> {
            const countWords = (s: string) => s.trim().split(/\s+/).length;
            // Validate text filters (API constraint)
            if (params.includeText && countWords(params.includeText) > 5) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: \`includeText\` has a maximum limit of 5 words (provided ${countWords(params.includeText)}). Keep it concise, e.g., "benchmark results".`,
                        },
                    ],
                };
            }
            if (params.excludeText && countWords(params.excludeText) > 5) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: \`excludeText\` has a maximum limit of 5 words (provided ${countWords(params.excludeText)}). Keep it concise, e.g., "login page".`,
                        },
                    ],
                };
            }

            // Validate numResults
            if (
                params.numResults !== undefined &&
                (params.numResults < 1 || params.numResults > 10)
            ) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: \`numResults\` must be between 1 and 10 (Exa API limit). You provided ${params.numResults}.`,
                        },
                    ],
                };
            }

            const texts = params.queries ?? (params.query ? [params.query] : []);
            if (texts.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Error: Provide either `query` (single) or `queries` (2-4 array).',
                        },
                    ],
                };
            }

            if (texts.length > 4) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: [
                                `Error: Maximum 4 queries per call (provided ${texts.length}).`,
                                '',
                                'Split your queries into smaller batches for better focus and to avoid rate limits.',
                                `  Batch 1: ${texts
                                    .slice(0, 4)
                                    .map((q) => `"${q}"`)
                                    .join(', ')}`,
                                `  Batch 2: ${texts
                                    .slice(4, 8)
                                    .map((q) => `"${q}"`)
                                    .join(', ')}`,
                            ]
                                .filter(Boolean)
                                .join('\n'),
                        },
                    ],
                };
            }
            const results = await Promise.all(
                texts.map((text) => service.search(toQuery(text, params), signal)),
            );
            const { text, totalUnique } = formatResults(results, texts);
            return {
                content: [{ type: 'text', text }],
                details: { queries: texts.length, uniqueUrls: totalUnique },
            };
        },
    };
}

function toQuery(text: string, params: WebSearchParams): SearchQuery {
    return {
        text,
        ...(params.numResults !== undefined ? { numResults: params.numResults } : {}),
        ...(params.type !== undefined ? { type: params.type } : {}),
        ...(params.category !== undefined ? { category: params.category } : {}),
        ...(params.recency !== undefined ? { recency: params.recency } : {}),
        ...(params.domains !== undefined ? { domains: params.domains } : {}),
        ...(params.includeText !== undefined ? { includeText: params.includeText } : {}),
        ...(params.excludeText !== undefined ? { excludeText: params.excludeText } : {}),
    };
}

type SearchResponse = import('../../modules/search/search.types.js').SearchResponse;
type SearchHit = import('../../modules/search/search.types.js').SearchHit;
type SearchResult = { ok: true; value: SearchResponse } | { ok: false; error: { message: string } };

/**
 * Format search results as a single deduplicated list. Hits are merged by URL
 * across all queries (keeping the highest-scoring occurrence, first-seen order),
 * so the agent gets one clean list instead of repeated per-query blocks.
 */
function formatResults(
    results: SearchResult[],
    texts: string[],
): { text: string; totalUnique: number } {
    const byUrl = new Map<string, SearchHit>();
    for (const r of results) {
        if (!r.ok) continue;
        for (const h of r.value.hits) {
            const existing = byUrl.get(h.url);
            if (!existing || (h.score ?? 0) > (existing.score ?? 0)) {
                byUrl.set(h.url, h);
            }
        }
    }
    const hits = [...byUrl.values()];

    const header =
        texts.length === 1
            ? `# web_search: "${texts[0]}" \u2014 ${hits.length} result(s)`
            : `# web_search: ${texts.length} queries \u2014 ${hits.length} unique result(s)\n${texts
                  .map((t) => `  - ${t}`)
                  .join('\n')}`;

    const body = hits.length > 0 ? hits.map(formatHit).join('\n\n') : 'No results.';

    const failures = results
        .map((r, i) => (r.ok ? undefined : `Query "${texts[i]}" failed: ${r.error.message}`))
        .filter((f): f is string => f !== undefined);
    const failBlock = failures.length > 0 ? `\n\n${failures.join('\n')}` : '';

    return { text: `${header}\n\n${body}${failBlock}`, totalUnique: hits.length };
}

function formatHit(h: SearchHit, i: number): string {
    const meta = [h.url, h.author].filter(Boolean).join(' \u00b7 ');
    const snippet = cleanSnippet(h.title, h.snippet);
    return `${i + 1}. ${h.title}\n   ${meta}${snippet ? `\n   ${snippet}` : ''}`;
}

const SNIPPET_DISPLAY_MAX = 200;

/**
 * Clean a snippet for display: collapse whitespace, strip a leading copy of the
 * title (Exa highlights frequently repeat it), and cap the length.
 */
function cleanSnippet(title: string, snippet: string): string {
    let s = snippet.replace(/\s+/g, ' ').trim();
    const t = title.trim();
    if (t && s.toLowerCase().startsWith(t.toLowerCase())) {
        s = s
            .slice(t.length)
            .replace(/^[\s:\u2013\u2014|-]+/, '')
            .trim();
    }
    return s.length > SNIPPET_DISPLAY_MAX
        ? `${s.slice(0, SNIPPET_DISPLAY_MAX).trimEnd()}\u2026`
        : s;
}
