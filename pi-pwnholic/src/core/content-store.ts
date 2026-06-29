import { type Section, scoreSection } from './sections.js';

export interface StoredDoc {
    readonly url: string;
    readonly title: string;
    readonly sections: readonly Section[];
    readonly fullContent: string;
    readonly totalChars: number;
}

export interface SectionHit {
    readonly docIndex: number;
    readonly section: Section;
    readonly snippet: string;
}

/**
 * Out-of-context storage for large fetched pages. The tool returns a compact
 * outline; full content lives here and is pulled section-by-section on demand.
 *
 * `search` is a first-class method so a SQLite/FTS5-backed adapter can rank
 * natively without the caller changing.
 */
export interface ContentStore {
    put(docs: readonly StoredDoc[]): string;
    get(responseId: string): readonly StoredDoc[] | undefined;
    search(responseId: string, query: string, topK?: number): SectionHit[];
    clear(): void;
    /** Release backing resources (e.g. a SQLite handle). */
    close(): void;
}

export interface ContentStoreConfig {
    readonly maxResponses: number;
}

const SNIPPET_WINDOW = 240;
const DEFAULT_TOP_K = 5;

export class InMemoryContentStore implements ContentStore {
    private readonly responses = new Map<string, readonly StoredDoc[]>();

    constructor(private readonly config: ContentStoreConfig) {}

    put(docs: readonly StoredDoc[]): string {
        if (this.responses.size >= this.config.maxResponses) {
            const oldest = this.responses.keys().next().value;
            if (oldest !== undefined) this.responses.delete(oldest);
        }
        const id = newResponseId();
        this.responses.set(id, docs);
        return id;
    }

    get(responseId: string): readonly StoredDoc[] | undefined {
        return this.responses.get(responseId);
    }

    search(responseId: string, query: string, topK = DEFAULT_TOP_K): SectionHit[] {
        const docs = this.responses.get(responseId);
        if (!docs) return [];
        const terms = tokenize(query);
        const firstTerm = terms[0];
        if (firstTerm === undefined) return [];

        const scored: { hit: SectionHit; score: number }[] = [];
        docs.forEach((doc, docIndex) => {
            for (const section of doc.sections) {
                const score = scoreSection(section, terms);
                if (score > 0) {
                    scored.push({
                        score,
                        hit: {
                            docIndex,
                            section,
                            snippet: snippetAround(section.content, firstTerm),
                        },
                    });
                }
            }
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK).map((s) => s.hit);
    }

    clear(): void {
        this.responses.clear();
    }

    close(): void {
        this.responses.clear();
    }
}

export function newResponseId(): string {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

export function tokenize(query: string): string[] {
    return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function snippetAround(content: string, term: string): string {
    const pos = content.toLowerCase().indexOf(term);
    if (pos === -1) return content.slice(0, SNIPPET_WINDOW * 2).trim();
    const start = Math.max(0, pos - SNIPPET_WINDOW);
    const end = Math.min(content.length, pos + term.length + SNIPPET_WINDOW);
    return `${start > 0 ? '…' : ''}${content.slice(start, end).trim()}${end < content.length ? '…' : ''}`;
}

// --- presentation helpers (pure, used by the get_content tool) --------------

export function renderOutline(docs: readonly StoredDoc[]): string {
    const body = docs.map((doc, i) => renderDocOutline(doc, i)).join('\n\n');
    return `${body}\n\nRetrieve a section: get_content({ responseId, index, section }). Rank-search: get_content({ responseId, query }).`;
}

export function renderDocOutline(doc: StoredDoc, index: number): string {
    const head = `[${index}] ${doc.title || doc.url}\n<${doc.url}> — ${formatChars(doc.totalChars)}, ${doc.sections.length} section(s)`;
    const lines = doc.sections.map((s) => {
        const indent = '  '.repeat(s.level === 0 ? 0 : s.level - 1);
        const marker = s.heading
            ? `${s.level > 0 ? `${'#'.repeat(s.level)} ` : ''}${s.heading}`
            : '(intro)';
        return `  ${indent}[${s.id}] ${marker} — ${formatChars(s.charCount)}`;
    });
    return [head, ...lines].join('\n');
}

export function renderSection(
    doc: StoredDoc,
    docIndex: number,
    section: Section,
    offset = 0,
    limit?: number,
): string {
    const body =
        limit !== undefined
            ? section.content.slice(offset, offset + limit)
            : section.content.slice(offset);
    const title = section.heading || '(intro)';
    return `# ${doc.title || doc.url} › ${title}\n<${doc.url}> [${docIndex}:${section.id}]\n\n${body}`;
}

export function renderHits(hits: readonly SectionHit[], query: string): string {
    if (hits.length === 0) return `No matches for "${query}".`;
    const blocks = hits.map(
        (h) => `[${h.docIndex}:${h.section.id}] ${h.section.heading || '(intro)'}\n${h.snippet}`,
    );
    return `${blocks.join('\n\n---\n\n')}\n\nFetch a full section: get_content({ responseId, index, section }).`;
}

function formatChars(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k chars` : `${n} chars`;
}
