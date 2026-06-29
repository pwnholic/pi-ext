import { Type } from 'typebox';
import type { Searcher } from '../../modules/search/search.service.js';
import type {
    SearchCategory,
    SearchQuery,
    SearchType,
} from '../../modules/search/search.types.js';
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
            'Search the web via Exa and return synthesized results with sources.',
            '',
            '## Parameters',
            '- `query` (string)            Single search query. Use only for simple lookups.',
            '- `queries` (string[])       2-4 varied-angle queries for broader coverage. PREFERRED over `query`.',
            '- `numResults` (number)      Results per query. Default 5. MAX 10 (Exa free-plan cap).',
            '- `type` (string)           Search type: "auto" (default), "fast", "instant", "deep-lite", "deep", "deep-reasoning".',
            '                              Use "deep" for complex multi-step queries (4-15s latency). "auto" is best for most cases.',
            '- `category` (string)       Scope results: "company", "research paper", "news", "personal site", "financial report", "people".',
            '- `recency` (string)        Filter by publish date: "day", "week", "month", "year".',
            '- `domains` (string[])       Include or exclude domains. Prefix with `-` to exclude, e.g. ["github.com", "-pinterest.com"].',
            '- `includeText` (string)    String that must be present in webpage text (max 1 string, up to 5 words).',
            '- `excludeText` (string)    String that must not be present in webpage text (max 1 string, up to 5 words).',
            '',
            '## Best Practices',
            '1. ALWAYS prefer `queries` (plural) with 2-4 varied angles over a single `query`.',
            '   Good: queries: ["rust async runtime comparison", "tokio vs async-std performance", "rust async best practices"]',
            '   Bad:  query: "rust"',
            '2. Keep `numResults` at 5 (default). Never exceed 10 — silently capped.',
            '3. Use `recency: "month"` or `"week"` for time-sensitive topics (crypto, news, market data).',
            '4. Use `domains` to scope to authoritative sources or exclude noise.',
            '5. Use `category: "news"` for current events, `"research paper"` for academic content.',
            '6. Use `type: "deep"` for complex research questions requiring multi-step reasoning (4-15s latency).',
            '7. Use `includeText`/`excludeText` to filter by page content (max 5 words each).',
            '8. After search, use `fetch_content` to read full content of relevant URLs.',
            '',
            '## Anti-Patterns',
            '- Single vague query like { query: "crypto" } — too broad, low signal.',
            '- numResults > 10 — silently capped, wastes API budget.',
            '- Ignoring `recency` for fast-moving topics.',
            '- Using `type: "deep"` for simple lookups — unnecessary latency.',
        ].join('\n'),
        promptSnippet:
            'Search the web via Exa for research; ALWAYS prefer `queries` (2-4 varied angles) over a single `query`; keep numResults ≤ 10; use `recency` for time-sensitive topics; use `category` to scope results; use `type: "deep"` for complex research; follow up with fetch_content for full page content.',
        promptGuidelines: [
            'Prefer `queries` (plural) with 2-4 varied angles over a single `query` for broader coverage. Example: queries: ["rust async runtime comparison", "tokio vs async-std performance", "rust async best practices"].',
            'Keep `numResults` at the default 5. Never exceed 10 — results are silently capped by the Exa free-plan limit.',
            'Use `recency` ("day", "week", "month", "year") for time-sensitive topics such as crypto prices, breaking news, or library releases.',
            'Use `domains` to scope to authoritative sources (e.g. ["github.com", "stackoverflow.com"]) or exclude noise (e.g. ["-pinterest.com", "-medium.com"]).',
            'Use `category` to scope results: "news" for current events, "research paper" for academic content, "company" for company pages, "financial report" for SEC filings.',
            'Use `type: "deep"` for complex multi-step research questions requiring reasoning (4-15s latency). Use "auto" (default) for most other cases.',
            'Use `includeText`/`excludeText` to filter results by page content (max 1 string, up to 5 words each). Example: includeText: "benchmark results".',
            'After searching, use `fetch_content` on the most relevant URLs to read full page content.',
            'Avoid single vague queries like { query: "crypto" } — too broad, low signal. Always provide enough context in each query string.',
        ],
        parameters: Type.Object({
            query: Type.Optional(Type.String()),
            queries: Type.Optional(Type.Array(Type.String())),
            numResults: Type.Optional(Type.Number()),
            type: Type.Optional(
                Type.Union([
                    Type.Literal('auto'),
                    Type.Literal('fast'),
                    Type.Literal('instant'),
                    Type.Literal('deep-lite'),
                    Type.Literal('deep'),
                    Type.Literal('deep-reasoning'),
                ]),
            ),
            category: Type.Optional(
                Type.Union([
                    Type.Literal('company'),
                    Type.Literal('research paper'),
                    Type.Literal('news'),
                    Type.Literal('personal site'),
                    Type.Literal('financial report'),
                    Type.Literal('people'),
                ]),
            ),
            recency: Type.Optional(
                Type.Union([
                    Type.Literal('day'),
                    Type.Literal('week'),
                    Type.Literal('month'),
                    Type.Literal('year'),
                ]),
            ),
            domains: Type.Optional(Type.Array(Type.String())),
            includeText: Type.Optional(Type.String()),
            excludeText: Type.Optional(Type.String()),
        }),
        async execute(params, signal): Promise<ToolTextResult> {
            const texts = params.queries ?? (params.query ? [params.query] : []);
            if (texts.length === 0) {
                return {
                    content: [{ type: 'text', text: 'Error: provide `query` or `queries`.' }],
                };
            }

            const results = await Promise.all(
                texts.map((text) => service.search(toQuery(text, params), signal)),
            );

            // Deduplicate hits by URL across all queries, keeping the highest-scoring occurrence.
            const { blocks, totalUnique } = dedupeAndFormat(results, texts);
            return {
                content: [{ type: 'text', text: blocks }],
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

function formatResponse(r: import('../../modules/search/search.types.js').SearchResponse): string {
    const header = `# ${r.query} (${r.provider}, ${r.tookMs}ms)`;
    const hits = r.hits
        .map(
            (h, i) =>
                `${i + 1}. ${h.title}\n   ${h.url}${h.author ? `\n   ${h.author}` : ''}\n   ${h.snippet}`,
        )
        .join('\n');
    return `${header}\n\n${hits}`;
}

type SearchResult = { ok: true; value: import('../../modules/search/search.types.js').SearchResponse } | { ok: false; error: { message: string } };

/**
 * Deduplicate hits by URL across multiple query results, keeping the
 * highest-scoring occurrence. When duplicates are found, a consolidated
 * block lists all unique hits under a "Merged Results" header.
 */
function dedupeAndFormat(
    results: SearchResult[],
    texts: string[],
): { blocks: string; totalUnique: number } {
    // If only one query (or all failed), skip dedup and format per-query.
    const okResults = results.filter((r): r is { ok: true; value: import('../../modules/search/search.types.js').SearchResponse } => r.ok);
    if (okResults.length <= 1) {
        const blocks = results.map((r, i) =>
            r.ok ? formatResponse(r.value) : `Query "${texts[i]}" failed: ${r.error.message}`,
        );
        return { blocks: blocks.join('\n\n---\n\n'), totalUnique: okResults[0]?.value.hits.length ?? 0 };
    }

    // Deduplicate by URL, preferring the hit with the highest score.
    const byUrl = new Map<string, import('../../modules/search/search.types.js').SearchHit>();
    for (const r of okResults) {
        for (const h of r.value.hits) {
            const existing = byUrl.get(h.url);
            if (!existing || (h.score ?? 0) > (existing.score ?? 0)) {
                byUrl.set(h.url, h);
            }
        }
    }

    const uniqueHits = [...byUrl.values()];
    const perQueryBlocks = results.map((r, i) =>
        r.ok ? formatResponse(r.value) : `Query "${texts[i]}" failed: ${r.error.message}`,
    );
    const mergedBlock = `## Merged Results (${uniqueHits.length} unique, deduped from ${okResults.length} queries)\n${uniqueHits
        .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.author ? `\n   ${h.author}` : ''}\n   ${h.snippet}`)
        .join('\n')}`;

    return {
        blocks: `${perQueryBlocks.join('\n\n---\n\n')}\n\n---\n\n${mergedBlock}`,
        totalUnique: uniqueHits.length,
    };
}
