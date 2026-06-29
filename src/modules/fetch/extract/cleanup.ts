/**
 * Whitespace cleanup for extracted markdown.
 *
 * Ported to TypeScript from webclaw's `webclaw-cor./src/markdown.rs`
 * (https://github.com/0xMassi/webclaw, MIT License, (c) 0xMassi):
 * code-fence-aware whitespace collapsing.
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
