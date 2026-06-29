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
        description:
            'Search the web via Exa and return synthesized results with sources. ' +
            'Prefer `queries` (2-4 varied angles) over a single `query` for broader coverage.',
        promptSnippet:
            'Search the web via Exa for research; prefer queries (plural) for broader coverage',
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
