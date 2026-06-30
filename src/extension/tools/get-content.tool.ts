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
            'Retrieve stored page content from a previous `fetch_content` call.',
            'Keeps the context window lean by loading only the sections you need.',
            '',
            '## Modes',
            'OUTLINE (no section, no query):',
            '  Returns a navigable list of all sections with IDs, headings, and char counts.',
            '  ALWAYS start here to discover available section IDs.',
            '',
            '  Output example:',
            '  ```',
            '  [0] API Documentation',
            '  <https://example.com/docs> — 24.5k chars, 8 section(s)',
            '    [0] Introduction — 1.2k chars',
            '    [1] ## Getting Started — 3.4k chars',
            '    [2] ## Authentication — 5.1k chars',
            '    [3] ## API Reference — 8.2k chars',
            '    [4] ## Rate Limits — 1.8k chars',
            '    [5] ## Error Codes — 2.1k chars',
            '    [6] ## Changelog — 1.5k chars',
            '    [7] ## Support — 1.2k chars',
            '  ```',
            '',
            'SECTION (section set):',
            '  Returns full content of one section by ID. Use offset/limit for pagination.',
            '',
            '  Output example:',
            '  ```',
            '  # API Documentation › Authentication',
            '  <https://example.com/docs> [0:2] · 5.1k chars',
            '',
            '  All API requests require a Bearer token in the Authorization header...',
            '  ```',
            '',
            'SEARCH (query set):',
            '  Rank-searches sections via BM25. Returns top 5 matches with snippets.',
            '  Use when you do not know which section contains the information.',
            '',
            '  Output example:',
            '  ```',
            '  [0:2] Authentication',
            '  "...use OAuth2 refresh tokens to obtain new access tokens..."',
            '',
            '  ---',
            '',
            '  [0:5] Error Codes',
            '  "...invalid_grant error when refresh token is expired..."',
            '',
            '  Fetch a full section: get_content({ responseId, index, section }).',
            '  ```',
            '',
            '## Parameters',
            '| Param | Type | Default | Description |',
            '|-------|------|---------|-------------|',
            '| `responseId` | string | REQUIRED | ID from `fetch_content` result (10-char hex) |',
            '| `index` | number | 0 | Document index for multi-URL fetches (0=first, 1=second) |',
            '| `section` | string | - | Section ID from outline (e.g. "3") |',
            '| `query` | string | - | Search keywords for rank-search (concise terms, not sentences) |',
            '| `offset` | number | 0 | Character offset for section pagination |',
            '| `limit` | number | - | Max characters to return from a section |',
            '',
            '## Limitations',
            '- Max 50 stored responses per session (LRU eviction). Old responseIds may expire.',
            '- When expired, re-fetch with `fetch_content`.',
            '- `section` and `query` are mutually exclusive. Use one or the other, not both.',
        ].join('\n'),

        promptSnippet:
            'Retrieve stored page sections by responseId. ALWAYS get outline first (no section/query), then pull sections by ID or search with keywords.',

        promptGuidelines: [
            'WORKFLOW: outline first -> identify relevant section IDs -> fetch specific sections.',
            '',
            'Step 1 - Get outline:',
            '  { responseId: "a1b2c3d4e5" }',
            '',
            'Step 2a - Fetch a section:',
            '  { responseId: "a1b2c3d4e5", section: "3" }',
            '',
            'Step 2b - Or search when unsure which section:',
            '  { responseId: "a1b2c3d4e5", query: "oauth2 refresh token" }',
            '',
            'Step 3 - Paginate if section is long:',
            '  { responseId: "a1b2c3d4e5", section: "3", offset: 0, limit: 2000 }',
            '  { responseId: "a1b2c3d4e5", section: "3", offset: 2000, limit: 2000 }',
            '',
            'For multi-URL fetches, ALWAYS specify `index`:',
            '  { responseId: "a1b2c3d4e5", index: 1 }  // second URL from the batch',
            '',
            'Search query style:',
            '  GOOD: { query: "oauth2 token refresh" }',
            '  BAD:  { query: "how does the authentication system handle OAuth2 token refresh" }',
            '',
            'Error recovery:',
            '  - "No stored content" -> responseId expired, re-fetch with `fetch_content`',
            '  - "Section not found" -> get outline first, section IDs may have changed',
            '  - "Invalid responseId" -> check for typos, must be 10-char hex from fetch_content result',
        ],

        parameters: Type.Object({
            responseId: Type.String({
                description: 'ID from `fetch_content` result details (10-char hex string)',
            }),
            index: Type.Optional(
                Type.Number({
                    description:
                        'Document index for multi-URL fetches (0 = first URL, 1 = second, etc.)',
                    minimum: 0,
                    default: 0,
                }),
            ),
            section: Type.Optional(
                Type.String({
                    description:
                        'Section ID from the outline (e.g. "3"). Mutually exclusive with query.',
                }),
            ),
            query: Type.Optional(
                Type.String({
                    description:
                        'Search keywords for rank-search. Use concise terms, not full sentences. Mutually exclusive with section.',
                }),
            ),
            offset: Type.Optional(
                Type.Number({
                    description: 'Character offset for section pagination',
                    minimum: 0,
                    default: 0,
                }),
            ),
            limit: Type.Optional(
                Type.Number({
                    description: 'Max characters to return from a section',
                    minimum: 100,
                }),
            ),
        }),

        execute(params): Promise<ToolTextResult> {
            if (!params.responseId || !/^[a-f0-9]{10}$/i.test(params.responseId)) {
                return Promise.resolve({
                    content: [
                        {
                            type: 'text',
                            text: [
                                `Error: Invalid responseId format "${params.responseId}".`,
                                '',
                                'responseId must be a 10-character hex string from a `fetch_content` result.',
                                'Check the `details.responseId` field from your fetch_content call.',
                                '',
                                'If you do not have the responseId, re-fetch the page with `fetch_content`.',
                            ].join('\n'),
                        },
                    ],
                });
            }

            if (params.section && params.query) {
                return Promise.resolve({
                    content: [
                        {
                            type: 'text',
                            text: [
                                'Error: `section` and `query` are mutually exclusive.',
                                '',
                                'To read a specific section: { responseId: "...", section: "3" }',
                                'To search across sections: { responseId: "...", query: "your keywords" }',
                            ].join('\n'),
                        },
                    ],
                });
            }

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
        const offset = params.offset ?? 0;
        const limit = params.limit;
        const body = renderSection(doc, docIndex, section, offset, limit);
        let footer = '';
        if (limit !== undefined) {
            const shown = Math.min(limit, Math.max(0, section.charCount - offset));
            const remaining = Math.max(0, section.charCount - offset - shown);
            if (remaining > 0) {
                footer = `\n\n> Showing ${shown} of ${section.charCount} chars (offset ${offset}). ${remaining} remain. Next: get_content({ responseId: "${params.responseId}", index: ${docIndex}, section: "${section.id}", offset: ${offset + shown}, limit: ${limit} }).`;
            } else {
                footer = `\n\n> End of section (${section.charCount} chars).`;
            }
        }
        return text(`${body}${footer}`, {
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
