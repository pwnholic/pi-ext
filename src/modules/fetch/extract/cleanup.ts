/**
 * Whitespace cleanup and markdown stripping.
 *
 * Ported to TypeScript from webclaw's `webclaw-core/src/markdown.rs`
 * (https://github.com/0xMassi/webclaw, MIT License, (c) 0xMassi):
 * code-fence-aware whitespace collapsing and the regex-based markdown stripper
 * used to derive the plain-text view.
 */

/** Collapse runs of blank lines to at most two, preserving code fences exactly. */
export function collapseWhitespace(s: string): string {
    const result: string[] = [];
    let consecutiveNewlines = 0;
    let inFence = false;

    const pushNoExtraNewline = (line: string): void => {
        const last = result[result.length - 1];
        if (last !== undefined && !last.endsWith('\n')) result.push('\n');
        result.push(line);
    };

    for (const line of s.split('\n')) {
        if (line.trimStart().startsWith('```')) {
            inFence = !inFence;
            consecutiveNewlines = 0;
            pushNoExtraNewline(line.trimEnd());
            result.push('\n');
            continue;
        }
        if (inFence) {
            result.push(line.trimEnd(), '\n');
            continue;
        }
        const trimmed = line.trimEnd();
        if (trimmed === '') {
            consecutiveNewlines += 1;
            if (consecutiveNewlines <= 2) result.push('\n');
        } else {
            consecutiveNewlines = 0;
            pushNoExtraNewline(trimmed);
            result.push('\n');
        }
    }

    return result.join('').trim();
}

const IMG_RE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const ITALIC_RE = /\*([^*]+)\*/g;
const CODE_RE = /`([^`]+)`/g;
const HEADING_RE = /^#{1,6}\s+/gm;
const TABLE_SEP_RE = /^\|\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|$/;

/** Reduce markdown to plain text: drop syntax, flatten tables, strip fences. */
export function stripMarkdown(md: string): string {
    let s = md
        .replace(IMG_RE, '$1')
        .replace(LINK_RE, '$1')
        .replace(BOLD_RE, '$1')
        .replace(ITALIC_RE, '$1')
        .replace(CODE_RE, '$1')
        .replace(HEADING_RE, '');

    const lines: string[] = [];
    let inFence = false;
    for (const line of s.split('\n')) {
        if (line.trimStart().startsWith('```')) {
            inFence = !inFence;
            continue;
        }
        if (inFence) {
            lines.push(line);
            continue;
        }
        const trimmed = line.trim();
        if (TABLE_SEP_RE.test(trimmed)) continue;
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            lines.push(
                trimmed
                    .replace(/^\|/, '')
                    .replace(/\|$/, '')
                    .split('|')
                    .map((c) => c.trim())
                    .join('\t'),
            );
            continue;
        }
        lines.push(line);
    }
    s = lines.join('\n');
    return s;
}
