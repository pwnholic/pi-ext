import { afterEach, describe, expect, it } from 'vitest';
import type { StoredDoc } from '../src/core/content-store.js';
import { buildSections } from '../src/core/sections.js';
import { SqliteContentStore } from '../src/core/sqlite-content-store.js';

const MARKDOWN = `intro before headings

# Title

lead

## Installation

run npm install to set up the widget tooling

## Usage

call the render api to produce output

## Troubleshooting

if it errors, check the api key`;

function storedDoc(markdown = MARKDOWN): StoredDoc {
    return {
        url: 'https://x.com',
        title: 'Doc',
        sections: buildSections(markdown),
        fullContent: markdown,
        totalChars: markdown.length,
    };
}

let stores: SqliteContentStore[] = [];
function make(maxResponses = 10): SqliteContentStore {
    const store = new SqliteContentStore({ maxResponses });
    stores.push(store);
    return store;
}

afterEach(() => {
    for (const s of stores) s.close();
    stores = [];
});

describe('SqliteContentStore', () => {
    it('round-trips documents and sections', () => {
        const store = make();
        const id = store.put([storedDoc()]);
        const docs = store.get(id);
        expect(docs?.length).toBe(1);
        const headings = docs![0]!.sections.filter((s) => s.level > 0).map((s) => s.heading);
        expect(headings).toEqual(['Title', 'Installation', 'Usage', 'Troubleshooting']);
        expect(store.get('missing')).toBeUndefined();
    });

    it('ranks sections with FTS5 (BM25)', () => {
        const store = make();
        const id = store.put([storedDoc()]);
        const hits = store.search(id, 'install');
        expect(hits[0]?.section.heading).toBe('Installation');
        expect(hits[0]?.snippet).toContain('npm install');
    });

    it('returns no hits for an empty/absent query', () => {
        const store = make();
        const id = store.put([storedDoc()]);
        expect(store.search(id, '   ')).toEqual([]);
    });

    it('evicts the oldest response past the cap (cascades to sections)', () => {
        const store = make(1);
        const first = store.put([storedDoc()]);
        store.put([storedDoc()]);
        expect(store.get(first)).toBeUndefined();
        expect(store.search(first, 'install')).toEqual([]);
    });

    it('clear empties all tables', () => {
        const store = make();
        const id = store.put([storedDoc()]);
        store.clear();
        expect(store.get(id)).toBeUndefined();
    });
});
