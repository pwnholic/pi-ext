import { describe, expect, it } from 'vitest';
import {
    InMemoryContentStore,
    renderDocOutline,
    renderHits,
    renderSection,
    type StoredDoc,
} from '../src/core/content-store.js';
import { buildSections } from '../src/core/sections.js';

const MARKDOWN = `intro paragraph before any heading

# Title

lead text

## Installation

run npm install to set up the widget tooling

## Usage

call the widget api to render output

## Troubleshooting

if the widget errors, check the api key`;

function storedDoc(markdown: string, maxSectionChars = 4000): StoredDoc {
    const sections = buildSections(markdown, maxSectionChars);
    return {
        url: 'https://x.com',
        title: 'Doc',
        sections,
        fullContent: markdown,
        totalChars: markdown.length,
    };
}

describe('buildSections', () => {
    it('splits by heading and keeps a preamble as the intro section', () => {
        const sections = buildSections(MARKDOWN);
        expect(sections[0]?.level).toBe(0);
        expect(sections[0]?.content).toContain('intro paragraph');
        const headings = sections.filter((s) => s.level > 0).map((s) => s.heading);
        expect(headings).toEqual(['Title', 'Installation', 'Usage', 'Troubleshooting']);
        expect(sections.every((s) => s.charCount === s.content.length)).toBe(true);
    });

    it('chunks oversized sections so every unit stays addressable', () => {
        const big = `# Big\n\n${'word '.repeat(2000)}`;
        const sections = buildSections(big, 500);
        expect(sections.length).toBeGreaterThan(1);
        expect(sections.every((s) => s.charCount <= 500)).toBe(true);
        expect(sections.map((s) => s.id)).toEqual(sections.map((_, i) => String(i)));
    });
});

describe('InMemoryContentStore', () => {
    it('stores and retrieves by responseId', () => {
        const store = new InMemoryContentStore({ maxResponses: 10 });
        const id = store.put([storedDoc(MARKDOWN)]);
        expect(store.get(id)?.length).toBe(1);
        expect(store.get('missing')).toBeUndefined();
    });

    it('rank-searches sections and returns the most relevant first', () => {
        const store = new InMemoryContentStore({ maxResponses: 10 });
        const id = store.put([storedDoc(MARKDOWN)]);
        const hits = store.search(id, 'install');
        expect(hits[0]?.section.heading).toBe('Installation');
        expect(hits[0]?.snippet).toContain('npm install');
    });

    it('weights heading matches above body matches', () => {
        const store = new InMemoryContentStore({ maxResponses: 10 });
        const id = store.put([storedDoc(MARKDOWN)]);
        // "widget" appears in several bodies but "Usage" body mentions widget api;
        // a heading-targeted term should rank its section first.
        const hits = store.search(id, 'troubleshooting');
        expect(hits[0]?.section.heading).toBe('Troubleshooting');
    });

    it('evicts the oldest response past the cap', () => {
        const store = new InMemoryContentStore({ maxResponses: 1 });
        const first = store.put([storedDoc(MARKDOWN)]);
        store.put([storedDoc(MARKDOWN)]);
        expect(store.get(first)).toBeUndefined();
    });
});

describe('presentation', () => {
    it('renders an outline with addressable section ids', () => {
        const outline = renderDocOutline(storedDoc(MARKDOWN), 0);
        expect(outline).toContain('[0]');
        expect(outline).toContain('## Installation');
        expect(outline).toMatch(/\[\d+\] ## Usage/);
    });

    it('renders a no-match message for an empty search', () => {
        expect(renderHits([], 'zzz')).toContain('No matches');
    });

    it('labels chunked heading-less sections by their part name, not all (intro)', () => {
        // A long heading-less doc is chunked into part 1, part 2, ... at level 0.
        const big = `${'word '.repeat(2000)}`;
        const doc: StoredDoc = {
            url: 'https://x.com',
            title: 'Big',
            sections: buildSections(big, 500),
            fullContent: big,
            totalChars: big.length,
        };
        const outline = renderDocOutline(doc, 0);
        expect(outline).toContain('part 1');
        expect(outline).toContain('part 2');
        // Only a genuine empty-heading intro would show "(intro)".
        expect(outline).not.toContain('(intro)');
    });

    it('renderSection includes char count and nudges large sections', () => {
        const bigDoc: StoredDoc = {
            url: 'https://x.com',
            title: 'Doc',
            sections: [
                { id: '0', level: 1, heading: 'Big', content: 'a'.repeat(5000), charCount: 5000 },
            ],
            fullContent: 'a'.repeat(5000),
            totalChars: 5000,
        };
        const section = bigDoc.sections[0];
        if (!section) throw new Error('expected section');
        const out = renderSection(bigDoc, 0, section);
        expect(out).toContain('chars');
        expect(out).toContain('large — use offset/limit');
    });

    it('renderSection omits the large nudge when a limit is set', () => {
        const bigDoc: StoredDoc = {
            url: 'https://x.com',
            title: 'Doc',
            sections: [
                { id: '0', level: 1, heading: 'Big', content: 'a'.repeat(5000), charCount: 5000 },
            ],
            fullContent: 'a'.repeat(5000),
            totalChars: 5000,
        };
        const section = bigDoc.sections[0];
        if (!section) throw new Error('expected section');
        const out = renderSection(bigDoc, 0, section, 0, 500);
        expect(out).not.toContain('large — use offset/limit');
    });
});
