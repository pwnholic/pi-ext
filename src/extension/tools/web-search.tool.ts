import { Type } from 'typebox';
import type { Searcher } from '../../modules/search/search.service.js';
import type { SearchQuery } from '../../modules/search/search.types.js';
import type { ToolDefinition, ToolTextResult } from '../ports.js';

export interface WebSearchParams {
    query?: string;
    queries?: string[];
    numResults?: number;
    recency?: 'day' | 'week' | 'month' | 'year';
    domains?: string[];
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
            '- `recency` (string)         Filter by publish date: "day", "week", "month", "year".',
            '- `domains` (string[])       Include or exclude domains. Prefix with `-` to exclude, e.g. ["github.com", "-pinterest.com"].',
            '',
            '## Best Practices',
            '1. ALWAYS prefer `queries` (plural) with 2-4 varied angles over a single `query`.',
            '   Good: queries: ["rust async runtime comparison", "tokio vs async-std performance", "rust async best practices"]',
            '   Bad:  query: "rust"',
            '2. Keep `numResults` at 5 (default). Never exceed 10 — silently capped.',
            '3. Use `recency: "month"` or `"week"` for time-sensitive topics (crypto, news, market data).',
            '4. Use `domains` to scope to authoritative sources or exclude noise.',
            '5. After search, use `fetch_content` to read full content of relevant URLs.',
            '',
            '## Anti-Patterns',
            '- Single vague query like { query: "crypto" } — too broad, low signal.',
            '- numResults > 10 — silently capped, wastes API budget.',
            '- Ignoring `recency` for fast-moving topics.',
        ].join('\n'),
        promptSnippet:
            'Search the web via Exa for research; ALWAYS prefer `queries` (2-4 varied angles) over a single `query`; keep numResults ≤ 10; use `recency` for time-sensitive topics; follow up with fetch_content for full page content.',
        promptGuidelines: [
            'Prefer `queries` (plural) with 2-4 varied angles over a single `query` for broader coverage. Example: queries: ["rust async runtime comparison", "tokio vs async-std performance", "rust async best practices"].',
            'Keep `numResults` at the default 5. Never exceed 10 — results are silently capped by the Exa free-plan limit.',
            'Use `recency` ("day", "week", "month", "year") for time-sensitive topics such as crypto prices, breaking news, or library releases.',
            'Use `domains` to scope to authoritative sources (e.g. ["github.com", "stackoverflow.com"]) or exclude noise (e.g. ["-pinterest.com", "-medium.com"]).',
            'After searching, use `fetch_content` on the most relevant URLs to read full page content.',
            'Avoid single vague queries like { query: "crypto" } — too broad, low signal. Always provide enough context in each query string.',
        ],
        parameters: Type.Object({
            query: Type.Optional(Type.String()),
            queries: Type.Optional(Type.Array(Type.String())),
            numResults: Type.Optional(Type.Number()),
            recency: Type.Optional(
                Type.Union([
                    Type.Literal('day'),
                    Type.Literal('week'),
                    Type.Literal('month'),
                    Type.Literal('year'),
                ]),
            ),
            domains: Type.Optional(Type.Array(Type.String())),
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

            const blocks = results.map((r, i) =>
                r.ok ? formatResponse(r.value) : `Query "${texts[i]}" failed: ${r.error.message}`,
            );
            return {
                content: [{ type: 'text', text: blocks.join('\n\n---\n\n') }],
                details: { queries: texts.length },
            };
        },
    };
}

function toQuery(text: string, params: WebSearchParams): SearchQuery {
    return {
        text,
        ...(params.numResults !== undefined ? { numResults: params.numResults } : {}),
        ...(params.recency !== undefined ? { recency: params.recency } : {}),
        ...(params.domains !== undefined ? { domains: params.domains } : {}),
    };
}

function formatResponse(r: import('../../modules/search/search.types.js').SearchResponse): string {
    const header = `# ${r.query} (${r.provider}, ${r.tookMs}ms)`;
    const answer = r.answer ? `\n\n${r.answer}` : '';
    const hits = r.hits
        .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
        .join('\n');
    return `${header}${answer}\n\n${hits}`;
}
