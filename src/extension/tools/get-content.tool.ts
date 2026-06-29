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
        description:
            'Retrieve stored page content captured by fetch_content, keeping the context window lean. ' +
            'No `section`/`query`: returns an outline of the document sections. ' +
            '`section`: returns that one section in full. ' +
            '`query`: rank-searches sections and returns the most relevant ones. ' +
            '`index` selects a document when multiple URLs were fetched.',
        promptSnippet: 'Pull a stored page section or rank-search stored content by responseId',
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
