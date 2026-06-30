import { describe, expect, it } from 'vitest';
import { InMemoryContentStore, type StoredDoc } from '../src/core/content-store.js';
import { buildSections } from '../src/core/sections.js';
import { createGetContentTool } from '../src/extension/tools/get-content.tool.js';

function doc(markdown: string, url = 'https://x.com', title = 'Doc'): StoredDoc {
    return {
        url,
        title,
        sections: buildSections(markdown, 4000),
        fullContent: markdown,
        totalChars: markdown.length,
    };
}

function storeWith(docs: StoredDoc[]): { store: InMemoryContentStore; id: string } {
    const store = new InMemoryContentStore({ maxResponses: 10 });
    const id = store.put(docs);
    return { store, id };
}

async function run(
    store: InMemoryContentStore,
    params: Record<string, unknown>,
): Promise<{ text: string; details?: Record<string, unknown> | undefined }> {
    const r = await createGetContentTool(store).execute(
        params as never,
        new AbortController().signal,
    );
    return { text: r.content[0]?.text ?? '', details: r.details };
}

describe('get_content tool', () => {
    it('errors when responseId is missing', async () => {
        const { store } = storeWith([doc('# Hi\n\nbody')]);
        const r = await run(store, {});
        expect(r.text).toContain('`responseId` is required');
    });

    it('errors on an unknown/expired responseId', async () => {
        const { store } = storeWith([doc('# Hi\n\nbody')]);
        const r = await run(store, { responseId: 'nope12345' });
        expect(r.text).toContain('No stored content');
    });

    it('outline mode lists sections with ids and char counts', async () => {
        const { store, id } = storeWith([
            doc('# Title\n\n## A\n\ntext a\n\n## B\n\ntext b', 'https://a.com', 'A Doc'),
        ]);
        const r = await run(store, { responseId: id });
        expect(r.text).toContain('[0] A Doc');
        expect(r.text).toContain('## A');
        expect(r.text).toMatch(/\[\d+\]/);
    });

    it('section mode returns the full section body', async () => {
        const { store, id } = storeWith([doc('# Title\n\n## A\n\nthe actual content here')]);
        const outline = await run(store, { responseId: id });
        const sectionId = outline.text.match(/\[(\d+)\] ## A/)?.[1];
        const r = await run(store, { responseId: id, section: sectionId });
        expect(r.text).toContain('the actual content here');
        expect(r.text).toContain('[0:');
        expect(r.details?.section).toBe(sectionId);
    });

    it('section mode with limit shows a pagination footer with the next offset', async () => {
        // Directly build a doc with one known large section (5000 chars).
        const body = 'a'.repeat(5000);
        const bigDoc: StoredDoc = {
            url: 'https://x.com',
            title: 'Big',
            sections: [{ id: '0', level: 1, heading: 'Big', content: body, charCount: 5000 }],
            fullContent: body,
            totalChars: 5000,
        };
        const { store, id } = storeWith([bigDoc]);
        const r = await run(store, { responseId: id, section: '0', offset: 0, limit: 500 });
        expect(r.text).toContain('remain.');
        expect(r.text).toContain('offset: 500');
        expect(r.text).toContain(`section: "0"`);
    });

    it('section mode at the tail reports end of section', async () => {
        const { store, id } = storeWith([doc('# Title\n\nshort body')]);
        const r = await run(store, { responseId: id, section: '0', offset: 0, limit: 10000 });
        expect(r.text).toContain('End of section');
    });

    it('query mode rank-searches and returns hits with docIndex:sectionId', async () => {
        const { store, id } = storeWith([
            doc('# Rust\n\n## async\n\ntokio runtime\n\n## sync\n\nstd threads', 'https://a.com'),
        ]);
        const r = await run(store, { responseId: id, query: 'tokio runtime' });
        expect(r.text).toContain('tokio');
        expect(r.text).toMatch(/\[\d+:\d+\]/);
        expect(r.details?.matches).toBeGreaterThan(0);
    });

    it('query mode with no matches reports so', async () => {
        const { store, id } = storeWith([doc('# Rust\n\n## async\n\ntokio runtime')]);
        const r = await run(store, { responseId: id, query: 'zzznomatch' });
        expect(r.text).toContain('No matches');
    });

    it('multi-doc: index selects the right document', async () => {
        const { store, id } = storeWith([
            doc('# First\n\n## A\n\nalpha', 'https://first.com', 'First'),
            doc('# Second\n\n## B\n\nbeta', 'https://second.com', 'Second'),
        ]);
        const r = await run(store, { responseId: id, index: 1, section: '1' });
        expect(r.text).toContain('beta');
        expect(r.text).toContain('https://second.com');
    });

    it('out-of-range index errors helpfully', async () => {
        const { store, id } = storeWith([doc('# Only\n\nbody')]);
        const r = await run(store, { responseId: id, index: 5 });
        expect(r.text).toContain('No document at index 5');
    });
});
