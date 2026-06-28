/**
 * Splits extracted markdown into addressable sections by heading, so large
 * pages can be presented as a navigable outline instead of a truncated blob.
 * Oversized sections (or heading-less documents) are chunked by size so every
 * unit stays retrievable and rank-searchable.
 */
export interface Section {
    /** Sequential id within a document, used as the retrieval handle. */
    readonly id: string;
    /** Heading depth 1-6; 0 marks the pre-heading intro. */
    readonly level: number;
    readonly heading: string;
    readonly content: string;
    readonly charCount: number;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

export function buildSections(markdown: string, maxSectionChars = 4000): Section[] {
    const out: Section[] = [];
    for (const raw of splitByHeading(markdown)) {
        if (raw.content.length <= maxSectionChars) {
            out.push({ id: String(out.length), ...raw, charCount: raw.content.length });
            continue;
        }
        const parts = chunkBySize(raw.content, maxSectionChars);
        parts.forEach((part, k) => {
            out.push({
                id: String(out.length),
                level: raw.level,
                heading: raw.heading ? `${raw.heading} (part ${k + 1})` : `part ${k + 1}`,
                content: part,
                charCount: part.length,
            });
        });
    }
    return out;
}

interface RawSection {
    level: number;
    heading: string;
    content: string;
}

function splitByHeading(markdown: string): RawSection[] {
    const sections: RawSection[] = [];
    let current: { level: number; heading: string; lines: string[] } | undefined;

    const flush = (): void => {
        if (!current) return;
        const content = current.lines.join('\n').trim();
        if (content !== '') {
            sections.push({ level: current.level, heading: current.heading, content });
        }
        current = undefined;
    };

    for (const line of markdown.split('\n')) {
        const match = HEADING_RE.exec(line);
        if (match) {
            flush();
            current = {
                level: (match[1] ?? '').length,
                heading: (match[2] ?? '').trim(),
                lines: [line],
            };
        } else {
            current ??= { level: 0, heading: '', lines: [] };
            current.lines.push(line);
        }
    }
    flush();
    return sections;
}

function chunkBySize(text: string, max: number): string[] {
    const paragraphs = text.split(/\n{2,}/);
    const chunks: string[] = [];
    let current = '';
    for (const para of paragraphs) {
        if (para.length > max) {
            if (current !== '') {
                chunks.push(current);
                current = '';
            }
            for (let i = 0; i < para.length; i += max) chunks.push(para.slice(i, i + max));
            continue;
        }
        if (current !== '' && current.length + para.length + 2 > max) {
            chunks.push(current);
            current = '';
        }
        current += (current === '' ? '' : '\n\n') + para;
    }
    if (current !== '') chunks.push(current);
    return chunks;
}

/** Keyword relevance score: term frequency in body, weighted 3x in the heading. */
export function scoreSection(section: Section, terms: readonly string[]): number {
    const body = section.content.toLowerCase();
    const heading = section.heading.toLowerCase();
    let score = 0;
    for (const term of terms) {
        score += countOccurrences(body, term) + 3 * countOccurrences(heading, term);
    }
    return score;
}

function countOccurrences(haystack: string, needle: string): number {
    if (needle === '') return 0;
    let count = 0;
    let pos = haystack.indexOf(needle);
    while (pos !== -1) {
        count += 1;
        pos = haystack.indexOf(needle, pos + needle.length);
    }
    return count;
}
