import { Type } from 'typebox';
import {
    type ContentStore,
    renderHits,
    renderOutline,
    renderSection,
} from '../../core/content-store.js';
import type { ToolDefinition, ToolTextResult } from '../ports.js';

export interface GetContentParams {
    responseId?: string;
    /** Document index within the response (default 0). */
    index?: number;
    /** Section id to retrieve in full. */
    section?: string;
    /** Rank-search sections across the response. */
    query?: string;
    offset?: number;
    limit?: number;
}

/**
 * Retrieves out-of-context page content captured by `fetch_content`. Without a
 * `section`/`query` it returns the section outline; `section` pulls one section
 * in full; `query` rank-searches sections (FTS-style) and returns the top hits.
 */
export function createGetContentTool(content: ContentStore): ToolDefinition<GetContentParams> {
    return {
        name: 'get_content',
        label: 'Get Content',
        description: [
            'Retrieve stored page content captured by `fetch_content`, keeping the context window lean.',
            'Three modes of operation:',
            '',
            '## Modes',
            '1. OUTLINE (no `section`, no `query`): Returns a navigable list of all sections with IDs,',
            '   headings, and char counts. ALWAYS start here to discover available section IDs.',
            '2. SECTION (`section` set): Returns the full content of one section by ID.',
            '   Use `offset`/`limit` for pagination on very long sections.',
            '3. SEARCH (`query` set): Rank-searches sections via FTS5/BM25 (or term-frequency fallback).',
            '   Returns top 5 matches with snippets. Use when you do not know which section is relevant.',
            '',
            '## Parameters',
            '- `responseId` (string)   REQUIRED. The ID returned by `fetch_content` (10-char hex).',
            '- `index` (number)       Document index when multiple URLs were fetched. Default 0.',
            '- `section` (string)     Section ID from the outline (e.g. "3").',
            '- `query` (string)       Rank-search keywords across all sections. Use concise keywords, not full sentences.',
            '- `offset` (number)      Character offset for section pagination. Default 0.',
            '- `limit` (number)       Max characters to return from the section (for pagination).',
            '',
            '## Best Practices',
            '1. ALWAYS call without `section`/`query` first to get the outline and discover section IDs.',
            '2. Then call with `section: "<id>"` to read the relevant section in full.',
            '3. If you do not know which section is relevant, use `query` with concise keywords:',
            '   Good: { responseId: "...", query: "oauth2 token refresh" }',
            '   Bad:  { responseId: "...", query: "how does the authentication system handle OAuth2 token refresh" }',
            '4. For multi-URL fetches, ALWAYS specify `index` (0 = first URL, 1 = second, etc.).',
            '5. If responseId is expired ("No stored content"), re-fetch the page with `fetch_content`.',
            '   Max 50 responses are retained per session (LRU eviction).',
            '',
            '## Anti-Patterns',
            '- Calling with `section` before checking the outline (section ID may not exist).',
            '- Using a long natural-language sentence as `query` (degrades rank-search quality).',
            '- Forgetting `index` on multi-document responses (defaults to 0, may read wrong page).',
        ].join('\n'),
        promptSnippet:
            'Retrieve stored page sections or rank-search stored content by responseId; ALWAYS get the outline first (no section/query), then pull specific sections or search with concise keywords; specify index for multi-URL fetches.',
        promptGuidelines: [
            'ALWAYS call `get_content` without `section` or `query` first to get the section outline and discover available section IDs.',
            'Then call with `section: "<id>"` to read a specific section in full. Never guess section IDs without checking the outline first.',
            'When searching, use concise keywords, not full natural-language sentences. Good: query: "oauth2 token refresh". Bad: query: "how does the authentication system handle OAuth2 token refresh".',
            'For multi-URL fetches (when `urls` was used in `fetch_content`), ALWAYS specify `index` (0 = first URL, 1 = second, etc.) to target the correct document.',
            'For very long sections, use `offset` and `limit` for pagination: { section: "7", offset: 0, limit: 2000 } retrieves the first 2,000 characters.',
            'If the responseId is expired ("No stored content"), re-fetch the page with `fetch_content`. Max 50 responses retained per session (LRU eviction).',
        ],
        parameters: Type.Object({
            responseId: Type.String(),
            index: Type.Optional(Type.Number()),
            section: Type.Optional(Type.String()),
            query: Type.Optional(Type.String()),
            offset: Type.Optional(Type.Number()),
            limit: Type.Optional(Type.Number()),
        }),
        execute(params): Promise<ToolTextResult> {
            return Promise.resolve(run(content, params));
        },
    };
}

function run(content: ContentStore, params: GetContentParams): ToolTextResult {
    if (!params.responseId) {
        return text('Error: `responseId` is required.');
    }
    const docs = content.get(params.responseId);
    if (!docs) {
        return text(
            `No stored content for responseId "${params.responseId}" (it may have expired or the id is wrong).`,
        );
    }

    if (params.query !== undefined && params.query !== '') {
        const hits = content.search(params.responseId, params.query);
        return text(renderHits(hits, params.query), {
            responseId: params.responseId,
            matches: hits.length,
        });
    }

    const docIndex = params.index ?? 0;
    const doc = docs[docIndex];
    if (!doc) {
        return text(`No document at index ${docIndex} (response has ${docs.length}).`);
    }

    if (params.section !== undefined) {
        const section = doc.sections.find((s) => s.id === String(params.section));
        if (!section) {
            return text(`No section "${params.section}" in document ${docIndex}.`);
        }
        return text(renderSection(doc, docIndex, section, params.offset, params.limit), {
            responseId: params.responseId,
            section: section.id,
        });
    }

    const outline = params.index === undefined ? renderOutline(docs) : renderOutline([doc]);
    return text(outline, { responseId: params.responseId, documents: docs.length });
}

function text(body: string, details?: Record<string, unknown>): ToolTextResult {
    return { content: [{ type: 'text', text: body }], ...(details ? { details } : {}) };
}
